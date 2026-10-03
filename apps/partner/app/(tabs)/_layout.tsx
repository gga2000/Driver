import { Tabs } from 'expo-router';
import { TabBar, type TabSpec } from '@/components/TabBar';
import { usePartnerGate } from '@/features/work/queries';
import { useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';

/** الرئيسية · الأرباح · الحساب — route order is the visual order (start → end). */
export default function TabsLayout() {
  const t = useT();
  const signedIn = useSignedIn();
  const gate = usePartnerGate();
  const tabs: TabSpec[] = [
    { name: 'index', label: t('partner.nav_home'), icon: 'home' },
    { name: 'earnings', label: t('partner.nav_earnings'), icon: 'wallet' },
    { name: 'account', label: t('partner.nav_account'), icon: 'user' },
  ];
  // Signed-out visitors and non-partners never mount the tabs (the guard is redirecting them).
  if (!signedIn || gate !== 'allowed') return null;
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} tabs={tabs} />}>
      {tabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}
