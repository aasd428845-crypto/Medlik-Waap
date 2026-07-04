interface StatusBadgeProps {
  status: string;
  type?: 'order' | 'invoice' | 'offer';
}

export function StatusBadge({ status, type = 'order' }: StatusBadgeProps) {
  let color = 'bg-gray-100 text-gray-800';
  let label = status;

  if (type === 'order') {
    switch (status) {
      case 'Submitted': color = 'bg-blue-100 text-blue-800'; label = 'مقدم'; break;
      case 'Allocated': color = 'bg-indigo-100 text-indigo-800'; label = 'مخصص'; break;
      case 'PartiallyShipped': color = 'bg-amber-100 text-amber-800'; label = 'مشحون جزئياً'; break;
      case 'Invoiced': color = 'bg-emerald-100 text-emerald-800'; label = 'مفوتر'; break;
      case 'OutForDelivery': color = 'bg-purple-100 text-purple-800'; label = 'في الطريق'; break;
      case 'Delivered': color = 'bg-green-100 text-green-800'; label = 'تم التوصيل'; break;
      default: label = status;
    }
  } else if (type === 'invoice') {
    switch (status) {
      case 'pending': color = 'bg-amber-100 text-amber-800'; label = 'قيد الانتظار'; break;
      case 'paid': color = 'bg-emerald-100 text-emerald-800'; label = 'مدفوعة'; break;
      case 'cancelled': color = 'bg-red-100 text-red-800'; label = 'ملغاة'; break;
    }
  } else if (type === 'offer') {
    switch (status) {
      case 'pending': color = 'bg-amber-100 text-amber-800'; label = 'قيد الانتظار ⏳'; break;
      case 'accepted': color = 'bg-emerald-100 text-emerald-800'; label = 'مقبول ✔'; break;
      case 'rejected': color = 'bg-red-100 text-red-800'; label = 'مرفوض ❌'; break;
    }
  }

  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${color}`}>
      {label}
    </span>
  );
}
