import React, { createContext, useState, useContext, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightTheme, darkTheme } from './theme';

type ThemeType = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: typeof lightTheme;
  themeType: ThemeType;
  setThemeType: (type: ThemeType) => void;
  isDarkMode: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: lightTheme,
  themeType: 'system',
  setThemeType: () => {},
  isDarkMode: false,
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const colorScheme = useColorScheme();
  const [themeType, setThemeType] = useState<ThemeType>('system');
  const [theme, setTheme] = useState(colorScheme === 'dark' ? darkTheme : lightTheme);
  
  // Load saved theme preference
  useEffect(() => {
    const loadThemePreference = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem('themePreference');
        if (savedTheme) {
          setThemeType(savedTheme as ThemeType);
        }
      } catch (error) {
        console.error('Failed to load theme preference:', error);
      }
    };
    
    loadThemePreference();
  }, []);
  
  // Update theme when themeType changes
  useEffect(() => {
    const saveThemePreference = async () => {
      try {
        await AsyncStorage.setItem('themePreference', themeType);
      } catch (error) {
        console.error('Failed to save theme preference:', error);
      }
    };
    
    let newTheme = lightTheme;
    
    if (themeType === 'system') {
      newTheme = colorScheme === 'dark' ? darkTheme : lightTheme;
    } else if (themeType === 'dark') {
      newTheme = darkTheme;
    } else {
      newTheme = lightTheme;
    }
    
    setTheme(newTheme);
    saveThemePreference();
  }, [themeType, colorScheme]);
  
  const isDarkMode = 
    (themeType === 'system' && colorScheme === 'dark') || 
    themeType === 'dark';
  
  return (
    <ThemeContext.Provider value={{ theme, themeType, setThemeType, isDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext); 