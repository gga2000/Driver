import { redirect } from 'next/navigation';

/** The console opens on the first live section; the map lands in a later Step 8 part. */
export default function Page() {
  redirect('/pricing');
}
