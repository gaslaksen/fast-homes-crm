import { Stack, useRouter } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { ChevronLeft } from '@/components/icons';
import { colors } from '@/theme';

/**
 * Lead flow (conversation → detail → edit) as a stack nested inside the tabs,
 * so the bottom tab bar stays visible. A single teal back chevron (router.back)
 * pops within the stack or returns to the originating tab.
 */
export default function LeadStackLayout() {
  const router = useRouter();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text, fontWeight: '600' },
        headerTitleAlign: 'center',
        headerLeft: () => (
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={10}
            style={{ paddingRight: 12 }}
          >
            <ChevronLeft size={26} color={colors.primary} />
          </TouchableOpacity>
        ),
      }}
    >
      <Stack.Screen name="[id]" options={{ title: 'Conversation' }} />
      <Stack.Screen name="detail/[id]" options={{ title: 'Lead' }} />
      <Stack.Screen name="disposition/[id]" options={{ title: 'Deal' }} />
      <Stack.Screen name="disposition-edit/[id]" options={{ title: 'Edit deal' }} />
      <Stack.Screen name="edit/[id]" options={{ title: 'Edit lead' }} />
    </Stack>
  );
}
