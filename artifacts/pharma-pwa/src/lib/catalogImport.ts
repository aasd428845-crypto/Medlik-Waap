import * as XLSX from 'xlsx';

export const catalogImportColumns = [
  'sku',
  'commercial_name',
  'scientific_name',
  'manufacturer',
  'dosage_form',
  'strength',
  'unit',
  'pack_size',
  'price',
  'is_cold_chain',
  'is_controlled_substance',
  'description',
] as const;

export type CatalogImportColumn = (typeof catalogImportColumns)[number];

export interface CatalogImportValues {
  sku: string;
  commercial_name: string;
  scientific_name: string;
  manufacturer: string;
  dosage_form: string;
  strength: string;
  unit: string;
  pack_size: number;
  price: number;
  is_cold_chain: boolean;
  is_controlled_substance: boolean;
  description: string;
}

export interface CatalogImportRow {
  rowNumber: number;
  values: CatalogImportValues;
  errors: string[];
}

const columnLabels: Record<CatalogImportColumn, string> = {
  sku: 'SKU',
  commercial_name: 'الاسم التجاري',
  scientific_name: 'الاسم العلمي',
  manufacturer: 'الشركة المصنعة',
  dosage_form: 'الشكل الدوائي',
  strength: 'التركيز',
  unit: 'الوحدة',
  pack_size: 'حجم العبوة',
  price: 'السعر',
  is_cold_chain: 'يحتاج تبريد',
  is_controlled_substance: 'مادة خاضعة للرقابة',
  description: 'الوصف',
};

const requiredColumns: CatalogImportColumn[] = ['sku', 'commercial_name', 'dosage_form', 'unit', 'pack_size', 'price'];

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/^\ufeff/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function toLatinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  const normalized = toLatinDigits(normalizeText(value)).replace(/,/g, '');
  return normalized === '' ? Number.NaN : Number(normalized);
}

function parseBoolean(value: unknown, label: string, errors: string[]): boolean {
  const normalized = toLatinDigits(normalizeText(value)).toLowerCase();
  if (!normalized) return false;
  if (['true', '1', 'yes', 'y', 'نعم', 'ن', 'صح'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'لا', 'ل', 'خطأ'].includes(normalized)) return false;
  errors.push(`قيمة ${label} يجب أن تكون نعم/لا أو true/false`);
  return false;
}

function valuesFromRow(rawRow: Record<string, unknown>): { values: CatalogImportValues; errors: string[] } {
  const row = Object.fromEntries(
    Object.entries(rawRow).map(([key, value]) => [normalizeHeader(key), value]),
  );
  const errors: string[] = [];
  const sku = normalizeText(row.sku);
  const commercialName = normalizeText(row.commercial_name);
  const dosageForm = normalizeText(row.dosage_form);
  const unit = normalizeText(row.unit);
  const packSize = parseNumber(row.pack_size);
  const price = parseNumber(row.price);

  if (!sku) errors.push('SKU مطلوب');
  if (!commercialName) errors.push('الاسم التجاري مطلوب');
  if (!dosageForm) errors.push('الشكل الدوائي مطلوب');
  if (!unit) errors.push('الوحدة مطلوبة');
  if (!Number.isInteger(packSize) || packSize < 1) errors.push('حجم العبوة يجب أن يكون رقمًا صحيحًا أكبر من صفر');
  if (!Number.isFinite(price) || price < 0) errors.push('السعر يجب أن يكون رقمًا يساوي صفرًا أو أكبر');

  const values: CatalogImportValues = {
    sku,
    commercial_name: commercialName,
    scientific_name: normalizeText(row.scientific_name),
    manufacturer: normalizeText(row.manufacturer),
    dosage_form: dosageForm,
    strength: normalizeText(row.strength),
    unit,
    pack_size: Number.isFinite(packSize) ? packSize : 1,
    price: Number.isFinite(price) ? price : 0,
    is_cold_chain: parseBoolean(row.is_cold_chain, columnLabels.is_cold_chain, errors),
    is_controlled_substance: parseBoolean(row.is_controlled_substance, columnLabels.is_controlled_substance, errors),
    description: normalizeText(row.description),
  };

  return { values, errors };
}

export async function parseCatalogImportFile(file: File): Promise<CatalogImportRow[]> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('الملف لا يحتوي على ورقة بيانات');

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  if (rawRows.length === 0) throw new Error('الملف لا يحتوي على صفوف بيانات');

  const headers = new Set(Object.keys(rawRows[0]).map(normalizeHeader));
  const missingColumns = requiredColumns.filter((column) => !headers.has(column));
  if (missingColumns.length > 0) {
    throw new Error(`الأعمدة المطلوبة غير موجودة: ${missingColumns.map((column) => columnLabels[column]).join('، ')}`);
  }

  const rows = rawRows.map((rawRow, index) => {
    const parsed = valuesFromRow(rawRow);
    return { rowNumber: index + 2, ...parsed };
  });
  const skuRows = new Map<string, number>();
  for (const row of rows) {
    if (!row.values.sku) continue;
    const firstRow = skuRows.get(row.values.sku);
    if (firstRow) {
      row.errors.push(`SKU مكرر في الملف مع الصف ${firstRow}`);
    } else {
      skuRows.set(row.values.sku, row.rowNumber);
    }
  }
  return rows;
}

export function catalogImportColumnLabel(column: CatalogImportColumn): string {
  return columnLabels[column];
}

export function catalogProductPayload(values: CatalogImportValues) {
  return {
    sku: values.sku,
    commercial_name: values.commercial_name,
    scientific_name: values.scientific_name || null,
    manufacturer: values.manufacturer || null,
    dosage_form: values.dosage_form,
    strength: values.strength || null,
    unit: values.unit,
    pack_size: values.pack_size,
    price: values.price,
    is_cold_chain: values.is_cold_chain,
    is_controlled_substance: values.is_controlled_substance,
    description: values.description || null,
    is_active: true,
    // Keep the shared Flutter schema in sync with the web catalog fields.
    name: values.commercial_name,
    name_en: values.scientific_name || null,
    category: values.dosage_form || 'أخرى',
    unit_price: values.price,
  };
}