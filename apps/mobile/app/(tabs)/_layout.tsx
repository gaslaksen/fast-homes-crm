import { Keyboard, TouchableOpacity } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { HomeIcon, MessageIcon, PhoneIcon, TrendingUpIcon, UsersIcon, ChevronLeft } from '@/components/icons';
import { useColors } from '@/theme';

export default function TabsLayout() {
  const colors = useColors();
  const router = useRouter();
  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerShown: false,
          tabBarIcon: ({ color }) => <HomeIcon size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color }) => <MessageIcon size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="leads"
        options={{
          title: 'Leads',
          tabBarIcon: ({ color }) => <UsersIcon size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="dialer"
        options={{
          title: 'Dialer',
          tabBarIcon: ({ color }) => <PhoneIcon size={22} color={color} />,
          // The keyboard hides the tab bar on this screen, so give an explicit
          // way back to Home once an input is focused.
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                Keyboard.dismiss();
                router.replace('/');
              }}
              hitSlop={10}
              style={{ paddingLeft: 12 }}
            >
              <ChevronLeft size={26} color={colors.primary} />
            </TouchableOpacity>
          ),
        }}
      />
      <Tabs.Screen
        name="deals"
        options={{
          title: 'Deals',
          tabBarIcon: ({ color }) => <TrendingUpIcon size={22} color={color} />,
        }}
      />
      <Tabs.Screen name="lead" options={{ href: null, headerShown: false }} />
    </Tabs>
  );
}
