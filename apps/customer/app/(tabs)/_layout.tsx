import { Tabs } from 'expo-router';
import { TabBar, type TabSpec } from '@/components/TabBar';
import { useAccountSync } from '@/features/account/sync';
import { useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';

/** الرئيسية · طلباتي · المحفظة · حسابي — route order is the visual order (start → end). */
export default function TabsLayout() {
  const t = useT();
  const signedIn = useSignedIn();
  // Saved places and the vault name → this device; device-only places → the server (once).
  useAccountSync();
  const tabs: TabSpec[] = [
    { name: 'index', label: t('nav.home'), icon: 'home' },
    { name: 'orders', label: t('nav.orders'), icon: 'receipt' },
    { name: 'wallet', label: t('nav.wallet_short'), icon: 'wallet' },
    { name: 'account', label: t('nav.account'), icon: 'user' },
  ];
  // Signed-out visitors never mount the tabs (the guard is redirecting them to /welcome).
  if (!signedIn) return null;
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} tabs={tabs} />}>
      {tabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}
