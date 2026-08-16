import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const API_KEY = Deno.env.get('EXCHANGE_RATE_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!API_KEY) {
      throw new Error('EXCHANGE_RATE_API_KEY غير مضبوط في إعدادات الدالة');
    }
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_URL أو SUPABASE_SERVICE_ROLE_KEY غير مضبوطين');
    }

    // استدعاء مزود الأسعار — الأساس YER فتُعطى الأسعار بالنسبة للريال
    const res = await fetch(`https://v6.exchangerate-api.com/v6/${API_KEY}/latest/YER`);
    if (!res.ok) {
      throw new Error(`exchangerate-api استجاب بـ ${res.status}`);
    }
    const json = await res.json();
    if (json.result !== 'success' || !json.conversion_rates) {
      throw new Error('استجابة غير صالحة من مزود الأسعار');
    }

    // conversion_rates.USD = سعر الدولار معطى بنسبة للريال اليمني (الأساس YER)
    // فسعر "الدولار = X ريال" هو مقلوب النسبة: 1 / conversion_rates.USD
    const usdYer = Number((1 / json.conversion_rates.USD).toFixed(4));
    const sarYer = Number((1 / json.conversion_rates.SAR).toFixed(4));
    if (!(usdYer > 0) || !(sarYer > 0)) {
      throw new Error('قيم أسعار غير صالحة');
    }

    const today = new Date().toISOString().slice(0, 10);
    const rows = [
      {
        from_currency_code: 'USD',
        to_currency_code: 'YER',
        rate: usdYer,
        effective_date: today,
        currency_code: 'USD',
        rate_to_yer: usdYer,
      },
      {
        from_currency_code: 'SAR',
        to_currency_code: 'YER',
        rate: sarYer,
        effective_date: today,
        currency_code: 'SAR',
        rate_to_yer: sarYer,
      },
    ];

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error } = await supabase.from('financial_exchange_rates').insert(rows);
    if (error) {
      throw new Error(error.message);
    }

    return new Response(
      JSON.stringify({ ok: true, usd: usdYer, sar: sarYer, fetchedAt: new Date().toISOString() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'خطأ غير معروف' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});