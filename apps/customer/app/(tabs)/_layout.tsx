import { Tabs } from 'expo-router';
import { useQuickActionRouting } from 'expo-quick-actions/router';
import { TabBar, type TabSpec } from '@/components/TabBar';
import { useT } from '@/lib/i18n';

/** الرئيسية · طلباتي · المحفظة · حسابي — route order is the visual order (start → end). */
export default function TabsLayout() {
  const t = useT();
  // Joy t1: a long-press shortcut on the app icon opens its screen (`params.href`); here, not in the
  // root layout, as the package asks (it navigates).
  useQuickActionRouting();
  const tabs: TabSpec[] = [
    { name: 'index', label: t('nav.home'), icon: 'home' },
    { name: 'orders', label: t('nav.orders'), icon: 'receipt' },
    { name: 'wallet', label: t('nav.wallet_short'), icon: 'wallet' },
    { name: 'account', label: t('nav.account'), icon: 'user' },
  ];
  // Guests browse the tabs too (audit C-18): orders, wallet and account show a "دخّل رقمك" card.
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} tabs={tabs} />}>
      {tabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}
