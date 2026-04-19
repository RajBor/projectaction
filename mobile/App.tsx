import 'react-native-gesture-handler'
import React from 'react'
import { StatusBar } from 'expo-status-bar'
import { NavigationContainer, DefaultTheme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import IndustryPicker from '@/screens/IndustryPicker'
import NewsFeed from '@/screens/NewsFeed'

export type RootStackParamList = {
  IndustryPicker: undefined
  NewsFeed: { channels: string[]; apiBase: string; apiKey: string }
}

const Stack = createNativeStackNavigator<RootStackParamList>()

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: '#c6a255',
    background: '#0b1e3a',
    card: '#0b1e3a',
    text: '#f1f5f9',
    border: '#1e3a66',
    notification: '#c6a255',
  },
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator
          initialRouteName="IndustryPicker"
          screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
        >
          <Stack.Screen name="IndustryPicker" component={IndustryPicker} />
          <Stack.Screen name="NewsFeed" component={NewsFeed} />
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style="light" />
    </SafeAreaProvider>
  )
}
