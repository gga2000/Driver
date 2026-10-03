import { redirect } from 'next/navigation';

/** The console opens on the live map. */
export default function Page() {
  redirect('/map');
}
