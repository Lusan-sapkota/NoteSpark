import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { RadioButton, Searchbar } from 'react-native-paper';
import { LANGUAGES } from '@notespark/core';
import Header from '../components/Header';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { useI18n } from '../i18n/I18nContext';
import { readingWidth, shape, space } from '../theme/theme';

const LanguageScreen: React.FC = () => {
  const { t, preference, setPreference } = useI18n();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const alert = useAlert();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const options = [{ label: t('settings.languageSystem'), value: 'system' }, ...LANGUAGES.map(l => ({ label: l.name, value: l.code }))]
    .filter(o => !q || o.label.toLowerCase().includes(q));

  const pick = (value: string) => {
    setPreference(value as typeof preference)
      .then(restart => { if (restart) alert(t('settings.languageRestartTitle'), t('settings.languageRestartBody')); })
      .catch(() => {});
    navigation.goBack();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header title={t('settings.language')} showBackButton onBackPress={() => navigation.goBack()} />
      <View style={styles.column}>
        <Searchbar
          placeholder={t('common.search')}
          value={query}
          onChangeText={setQuery}
          style={[styles.search, { backgroundColor: theme.colors.surfaceContainerHigh, borderRadius: shape.control }]}
          inputStyle={styles.searchInput}
        />
        <ScrollView keyboardShouldPersistTaps="handled">
          <RadioButton.Group value={preference} onValueChange={pick}>
            {options.map(o => <RadioButton.Item key={o.value} label={o.label} value={o.value} />)}
          </RadioButton.Group>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: readingWidth, alignSelf: 'center' },
  search: { marginHorizontal: space.lg, marginBottom: space.sm },
  searchInput: { minHeight: 0 },
});

export default LanguageScreen;
