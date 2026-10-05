import type { OrderState } from '@driver/contracts';
import type { ComponentType } from 'react';
import { orderStateLabel } from '@/lib/labels';
import { ORDER_PHASE, ORDER_STATE_TONE, type OrderPhase } from '@/lib/orders';
import { Chip, IconAlert, IconCheck, IconClock, IconClose, IconDrivers, IconStore, type IconProps } from './ui';

const PHASE_ICON: Record<OrderPhase, ComponentType<IconProps>> = {
  waiting: IconClock,
  kitchen: IconStore,
  road: IconDrivers,
  done: IconCheck,
  cancelled: IconClose,
  problem: IconAlert,
};

/** The order's state as a chip: the stage's icon, the state in words and the stage's tone (K-17). */
export function OrderStatus({ state, size = 'md' }: { state: OrderState; size?: 'sm' | 'md' }) {
  const Icon = PHASE_ICON[ORDER_PHASE[state]];
  return (
    <Chip tone={ORDER_STATE_TONE[state]} size={size}>
      <Icon size={size === 'sm' ? 12 : 13} className="shrink-0" />
      {orderStateLabel(state)}
    </Chip>
  );
}
