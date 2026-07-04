export type UserRole = 'client' | 'branch_manager' | 'company_director' | 'driver';

export interface User {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  branchId?: string;
  branchName?: string;
  orgName?: string;
  clientType?: string;
  city?: string;
  governorate?: string;
  phone?: string;
}

export interface PharmaProduct {
  productId: string;
  sku: string;
  commercialName: string;
  scientificName: string;
  manufacturer: string;
  dosageForm: string; // e.g. "أقراص", "كبسول", "شراب", "حقن"
  strength: string;
  isColdChain: boolean;
  isControlledSubstance: boolean;
  unit: string;
  packSize: number;
  price: number;
  description?: string;
  isActive: boolean;
}

export type OrderStatus = 'Draft' | 'Submitted' | 'Allocated' | 'PartiallyShipped' | 'Invoiced' | 'OutForDelivery' | 'Delivered';

export interface OrderLine {
  sku: string;
  productName: string;
  requestedQty: number;
  allocatedQty: number;
  unitPrice: number;
}

export interface Order {
  orderId: string;
  clientId: string;
  clientName: string;
  clientType: string;
  clientGovernorate: string;
  orderLines: OrderLine[];
  status: OrderStatus;
  orderStatus?: OrderStatus;
  targetBranches: string[];
  parentOrderId?: string;
  scheduledDeliveryDate?: string;
  totalAmount: number;
  createdAt: any; // Firestore Timestamp
}

export interface Invoice {
  invoiceId: string;
  orderId: string;
  branchId: string;
  totalAmount: number;
  status: string;
  createdAt: any;
  clientName: string;
  clientType?: string;
}

export interface Branch {
  branchId: string;
  branchName: string;
  governorate: string;
  latitude: number;
  longitude: number;
}

export interface WarehouseInventoryItem {
  id?: string;
  sku: string;
  name: string;
  dosageForm: string;
  availableQuantity: number;
  expiryDate?: string;
  branchId: string;
}

export interface BranchOffer {
  offerId: string;
  branchId: string;
  productSku: string;
  productName: string;
  offeredPrice: number;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: any;
}

export interface Address {
  addressId: string;
  branchId: string;
  addressText: string;
  latitude?: number;
  longitude?: number;
}

export interface DirectorNotification {
  notificationId?: string;
  orderId: string;
  branchId: string;
  message: string;
  createdAt: any;
  type: 'branch_alert';
}
