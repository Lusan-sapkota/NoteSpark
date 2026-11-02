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

const savedThemePromise = AsyncStorage.getItem('themePreference').catch(() => null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const colorScheme = useColorScheme();
  const [themeType, setThemeTypeState] = useState<ThemeType>('system');
  const [theme, setTheme] = useState(colorScheme === 'dark' ? darkTheme : lightTheme);
  
  useEffect(() => {
    savedThemePromise.then(savedTheme => {
      if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
        setThemeTypeState(savedTheme);
      }
    });
  }, []);

  const setThemeType = (type: ThemeType) => {
    setThemeTypeState(type);
    AsyncStorage.setItem('themePreference', type).catch(error => {
      console.error('Failed to save theme preference:', error);
    });
  };
  
  useEffect(() => {
    let newTheme = lightTheme;
    
    if (themeType === 'system') {
      newTheme = colorScheme === 'dark' ? darkTheme : lightTheme;
    } else if (themeType === 'dark') {
      newTheme = darkTheme;
    } else {
      newTheme = lightTheme;
    }
    
    setTheme(newTheme);
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