import { Stack, useRouter, usePathname } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { ChevronLeft } from '@/components/icons';
import { useColors } from '@/theme';

/**
 * Lead flow (conversation → detail → edit) as a stack nested inside the tabs,
 * so the bottom tab bar stays visible. A single teal back chevron pops within
 * the stack; on a cold entry (no stack history) it returns to the most likely
 * origin tab — the Inbox for a conversation, Home otherwise.
 *
 * The conversation screen overrides this chevron with one that always returns
 * to where it was opened from; see app/(tabs)/lead/[id].tsx.
 */
export default function LeadStackLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const colors = useColors();

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    // Cold entry (deep link / tab switch with no stack): pick a sensible home.
    // A bare /lead/<id> is the conversation, which belongs to the Inbox.
    const isConversation = /^\/lead\/[^/]+$/.test(pathname);
    router.replace(isConversation ? '/inbox' : '/');
  };

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text, fontWeight: '600' },
        headerTitleAlign: 'center',
        headerLeft: () => (
          <TouchableOpacity onPress={goBack} hitSlop={10} style={{ paddingRight: 12 }}>
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
      <Stack.Screen name="email/[id]" options={{ title: 'Email' }} />
      <Stack.Screen name="new" options={{ title: 'New lead' }} />
    </Stack>
  );
}
