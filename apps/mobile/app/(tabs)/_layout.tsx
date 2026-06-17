import { Tabs } from 'expo-router';
import { Text } from 'react-native';

/**
 * Tab shell. Icons are simple emoji placeholders for the skeleton; swap for a
 * proper icon set (e.g. @expo/vector-icons) when the design is in.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#2563EB',
        headerStyle: { backgroundColor: '#0F172A' },
        headerTintColor: '#fff',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>💬</Text>,
        }}
      />
      <Tabs.Screen
        name="dialer"
        options={{
          title: 'Dialer',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📞</Text>,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>⚙️</Text>,
        }}
      />
    </Tabs>
  );
}
