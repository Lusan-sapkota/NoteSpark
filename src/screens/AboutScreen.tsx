import React from 'react';
import { View, Text, StyleSheet, Linking, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

const GITHUB_URL = 'https://github.com/Lusan-sapkota/NoteSpark';
const DEVELOPER_EMAIL = 'lusan.sapkota@gmail.com';
const APP_VERSION = '1.0.0';
const LICENSE = 'GPLv3';

const AboutScreen = () => {
  const { theme } = useTheme();
  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}> 
      <Text style={[styles.title, { color: theme.colors.primary }]}>About NoteSpark</Text>
      <Text style={styles.text}>Developer: Lusan Sapkota</Text>
      <Text style={styles.text}>Contact: <Text style={styles.link} onPress={() => Linking.openURL(`mailto:${DEVELOPER_EMAIL}`)}>{DEVELOPER_EMAIL}</Text></Text>
      <Text style={styles.text}>Version: {APP_VERSION}</Text>
      <Text style={styles.text}>License: {LICENSE}</Text>
      <Text style={styles.text}>GitHub: <Text style={styles.link} onPress={() => Linking.openURL(GITHUB_URL)}>{GITHUB_URL}</Text></Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  text: {
    fontSize: 18,
    marginBottom: 12,
  },
  link: {
    color: '#1976D2',
    textDecorationLine: 'underline',
  },
});

export default AboutScreen;
