import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/queryClient';
import { usePushRegistration } from '@/features/push/usePushRegistration';
import { useNotificationRouting } from '@/features/push/useNotificationRouting';
import { useBadgeSync } from '@/features/push/useBadgeSync';
import { ChevronLeft } from '@/components/icons';
import { CallProvider } from '@/features/calls/CallContext';
import { ThemeProvider, useColors, useThemeMode } from '@/theme';

/** Redirects between the auth flow and the app shell based on session state. */
function AuthGate() {
  const { token, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colors = useColors();

  // Register for push + handle notification taps once signed in.
  usePushRegistration(!!token);
  useNotificationRouting();
  useBadgeSync(!!token);

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === 'login';
    if (!token && !inAuthGroup) {
      router.replace('/login');
    } else if (token && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [token, loading, segments]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
      <Stack.Screen
        name="settings"
        options={{
          headerShown: true,
          title: 'Settings',
          presentation: 'card',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.text, fontWeight: '600' },
          // iOS labels the back button with the previous route's name, which
          // here is the raw route group, "(tabs)". Use the same bare chevron
          // the rest of the app uses instead.
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
      />
    </Stack>
  );
}

function ThemedStatusBar() {
  const { scheme } = useThemeMode();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <CallProvider>
              <ThemedStatusBar />
              <AuthGate />
            </CallProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
