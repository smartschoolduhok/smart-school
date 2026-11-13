import { AlertTriangle } from 'lucide-react';
import type { SchoolAccess } from '../lib/schoolSubscriptions';

const NOTICE_DAYS = 14;

// Shown above every page for school users when the subscription is about to
// end, is in its grace period, or has become read-only.
export default function SubscriptionBanner({ subscription }: { subscription?: SchoolAccess | null }) {
  if (!subscription) return null;
  const { state, days_left: daysLeft, ends_on: endsOn, status } = subscription;
  let message: string | null = null;
  let tone = 'border-amber-200 bg-amber-50 text-amber-800';
  if (state === 'read_only') {
    tone = 'border-red-200 bg-red-50 text-red-700';
    message = status === 'suspended'
      ? 'اشتراك المدرسة موقوف؛ يمكن الاطلاع والطباعة فقط. تواصل مع إدارة النظام.'
      : 'انتهى اشتراك المدرسة ومهلته؛ يمكن الاطلاع والطباعة فقط. تواصل مع إدارة النظام للتجديد.';
  } else if (state === 'grace') {
    message = `انتهى اشتراك المدرسة بتاريخ ${endsOn}. يتحول البرنامج إلى الاطلاع فقط بعد ${daysLeft} يوم ما لم يُجدَّد.`;
  } else if (daysLeft != null && daysLeft <= NOTICE_DAYS) {
    message = daysLeft === 0 ? 'ينتهي اشتراك المدرسة اليوم.' : `ينتهي اشتراك المدرسة بعد ${daysLeft} يوم (${endsOn}).`;
  }
  if (!message) return null;
  return (
    <div role={state === 'read_only' ? 'alert' : 'status'} className={`mx-3 mt-3 flex items-start gap-2 rounded-lg border p-3 text-sm sm:mx-6 lg:mx-7 ${tone}`}>
      <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
