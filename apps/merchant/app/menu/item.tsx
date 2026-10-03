import { ItemEditor } from '@/features/menu/ItemEditor';

/** One dish: `?id=` edits it, no id adds one (`?category=` picks its section). */
export default function MenuItem() {
  return <ItemEditor />;
}
