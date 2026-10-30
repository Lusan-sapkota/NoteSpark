import React, { useEffect, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Appbar, Button, Icon, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { RootStackParamList } from '../types';
import {
  addProfile,
  canUseBiometrics,
  eraseForgottenProfile,
  getActiveProfile,
  getProfiles,
  hasProfilePin,
  Profile,
  setProfilePin,
  setUsesBiometrics,
  usesBiometrics,
  verifyProfilePin,
  wrongPinMessage,
} from '../storage/profiles';
import { useAlert } from '../components/DialogProvider';
import { useI18n } from '../i18n/I18nContext';
import { useTheme } from '../theme/ThemeContext';
import { controlTheme, groupCorners, readingWidth, space } from '../theme/theme';

type LockMode = 'none' | 'pin' | 'fingerprint';

type ProfileLockNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ProfileLock'>;

const digits = (value: string) => value.replace(/\D/g, '').slice(0, 4);

// A lock option. Selected shows a tonal fill and a filled radio, so it isn't color alone.
const LockChoice: React.FC<{
  icon: string;
  title: string;
  description: string;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  setUp?: boolean;
  onPress: () => void;
}> = ({ icon, title, description, selected, isFirst, isLast, setUp = false, onPress }) => {
  const { theme } = useTheme();
  const on = selected ? theme.colors.onSecondaryContainer : theme.colors.onSurface;
  const onVariant = selected ? theme.colors.onSecondaryContainer : theme.colors.onSurfaceVariant;
  return (
    <TouchableRipple
      onPress={onPress}
      accessibilityRole={setUp ? 'button' : 'radio'}
      accessibilityState={setUp ? undefined : { checked: selected }}
      accessibilityLabel={`${title}. ${description}`}
      style={[
        groupCorners(isFirst, isLast),
        styles.choice,
        { backgroundColor: selected ? theme.colors.secondaryContainer : theme.colors.surfaceContainerLow },
        !isLast && styles.choiceGap,
      ]}
    >
      <View style={styles.choiceRow}>
        <View style={[styles.choiceIcon, { backgroundColor: selected ? theme.colors.surface : theme.colors.surfaceContainerHighest }]}>
          <Icon source={icon} size={22} color={selected ? theme.colors.primary : theme.colors.onSurfaceVariant} />
        </View>
        <View style={styles.choiceText}>
          <Text variant="titleMedium" style={{ color: on }}>{title}</Text>
          <Text variant="bodyMedium" style={{ color: onVariant }}>{description}</Text>
        </View>
        {setUp ? (
          <Icon source="open-in-new" size={20} color={theme.colors.onSurfaceVariant} />
        ) : (
          <View style={[styles.radio, { borderColor: selected ? theme.colors.primary : theme.colors.outline }]}>
            {selected && <View style={[styles.radioDot, { backgroundColor: theme.colors.primary }]} />}
          </View>
        )}
      </View>
    </TouchableRipple>
  );
};

// New profile, or a profile's lock, as a full-screen dialog (too big for a centred one above the keyboard).
const ProfileLockScreen: React.FC = () => {
  const navigation = useNavigation<ProfileLockNavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, 'ProfileLock'>>();
  const profileId = route.params?.profileId;
  const { theme } = useTheme();
  const { t } = useI18n();
  const alert = useAlert();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [name, setName] = useState('');
  const [lock, setLock] = useState<LockMode>(profileId ? 'pin' : 'none');
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirmation, setPinConfirmation] = useState('');
  const [fingerprintReady, setFingerprintReady] = useState(false);
  const [saving, setSaving] = useState(false);

  const checkFingerprint = () => canUseBiometrics().then(setFingerprintReady).catch(() => setFingerprintReady(false));

  useEffect(() => {
    checkFingerprint();
    if (profileId) {
      (async () => {
        const found = (await getProfiles()).find(p => p.id === profileId) ?? null;
        setProfile(found);
        setIsOpen((await getActiveProfile()).id === profileId);
        const hasPin = await hasProfilePin(profileId);
        setLocked(hasPin);
        if (hasPin && (await usesBiometrics(profileId))) setLock('fingerprint');
      })().catch(() => alert(t('profiles.loadFailed'), t('profiles.loadFailedBody')));
    }
    // Back from the phone's settings after "Set up": check for a fingerprint again.
    const sub = AppState.addEventListener('change', state => state === 'active' && checkFingerprint());
    return () => sub.remove();
  }, [profileId]);

  const adding = !profileId;
  const pinOk = pin.length === 4 && pin === pinConfirmation;
  // A locked profile may keep its PIN (new PIN left empty); everything else that locks needs a PIN.
  const needsNewPin = lock !== 'none' && (!locked || !!(pin || pinConfirmation));
  const canSave =
    !saving &&
    (adding ? !!name.trim() : !!profile) &&
    (!locked || currentPin.length === 4) &&
    (!needsNewPin || pinOk) &&
    (adding || locked || lock !== 'none');

  const done = (message: string) => navigation.popTo('Settings', { message });

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (adding) {
        const created = await addProfile(name.trim(), lock === 'none' ? undefined : pin);
        if (lock === 'fingerprint' && fingerprintReady) await setUsesBiometrics(created.id, true);
        done(t('profiles.added', { name: created.name }));
        return;
      }
      if (!profile) return;
      if (locked && !(await verifyProfilePin(profile.id, currentPin))) {
        alert(t('profiles.incorrectPin'), await wrongPinMessage(profile.id));
        return;
      }
      if (lock === 'none') {
        alert(t('profiles.removeLockTitle'), t('profiles.removeLockBody', { name: profile.name }), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('profiles.removeLockAction'),
            style: 'destructive',
            onPress: async () => {
              try {
                await setProfilePin(profile.id, null, currentPin);
                done(t('profiles.lockRemoved', { name: profile.name }));
              } catch (error) {
                alert(t('profiles.removeLockFailed'), t('common.tryAgainRestart'));
              }
            },
          },
        ]);
        return;
      }
      if (pin) await setProfilePin(profile.id, pin, currentPin);
      await setUsesBiometrics(profile.id, lock === 'fingerprint' && fingerprintReady);
      done(t('profiles.lockSaved', { name: profile.name }));
    } catch (error) {
      alert(adding ? t('profiles.addFailed') : t('profiles.saveLockFailed'), t('common.tryAgainRestart'));
    } finally {
      setSaving(false);
    }
  };

  // A PIN can't be recovered, so a forgotten one means erasing the profile.
  const forgotPin = () => {
    if (!profile) return;
    alert(
      t('profiles.eraseTitle'),
      t('profiles.eraseBody', { name: profile.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profiles.eraseAction'),
          style: 'destructive',
          onPress: async () => {
            try {
              await eraseForgottenProfile(profile.id);
              done(t('profiles.erased', { name: profile.name }));
            } catch (error) {
              alert(t('profiles.eraseFailed'), t('common.tryAgainRestart'));
            }
          },
        },
      ]
    );
  };

  const sectionTitle = (title: string) => (
    <Text variant="titleSmall" accessibilityRole="header" style={[styles.sectionTitle, { color: theme.colors.primary }]}>{title}</Text>
  );

  const pinField = (label: string, value: string, onChange: (v: string) => void, extra?: Partial<React.ComponentProps<typeof TextInput>>) => (
    <TextInput
      mode="outlined"
      label={label}
      value={value}
      onChangeText={v => onChange(digits(v))}
      keyboardType="number-pad"
      secureTextEntry
      style={styles.field}
      {...extra}
    />
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Appbar.Header mode="small">
        <Appbar.Action icon="close" accessibilityLabel={t('profiles.closeWithoutSaving')} onPress={() => navigation.goBack()} />
        <Appbar.Content title={adding ? t('profiles.newProfile') : t('profiles.lockFor', { name: profile?.name ?? '' })} />
        <Button mode="contained" theme={controlTheme} onPress={save} disabled={!canSave} loading={saving} style={styles.save}>
          {t('common.save')}
        </Button>
      </Appbar.Header>

      <KeyboardAwareScrollView bottomOffset={space.xl} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.column}>
          {adding && (
            <>
              <TextInput mode="outlined" label={t('profiles.profileName')} value={name} onChangeText={setName} autoFocus maxLength={40} />
              <Text variant="bodySmall" style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
                {t('profiles.profileHelp')}
              </Text>
            </>
          )}

          {locked && (
            <>
              <Text variant="bodyLarge" style={{ color: theme.colors.onSurface }}>
                {t('profiles.enterCurrentPin', { name: profile?.name ?? '' })}
              </Text>
              {pinField(t('profiles.currentPin'), currentPin, setCurrentPin, { autoFocus: true })}
            </>
          )}

          {sectionTitle(t('profiles.lockSection'))}
          <View accessibilityRole="radiogroup">
            <LockChoice
              icon="lock-open-variant-outline"
              title={t('profiles.noLock')}
              description={t('profiles.noLockDescription')}
              selected={lock === 'none'}
              onPress={() => setLock('none')}
              isFirst
              isLast={false}
            />
            <LockChoice
              icon="dialpad"
              title={t('profiles.pin')}
              description={t('profiles.pinDescription')}
              selected={lock === 'pin'}
              onPress={() => setLock('pin')}
              isFirst={false}
              isLast={false}
            />
            <LockChoice
              icon={fingerprintReady ? 'fingerprint' : 'fingerprint-off'}
              title={t('profiles.fingerprint')}
              description={fingerprintReady ? t('profiles.fingerprintReady') : t('profiles.fingerprintSetUp')}
              selected={lock === 'fingerprint'}
              setUp={!fingerprintReady}
              onPress={() =>
                fingerprintReady
                  ? setLock('fingerprint')
                  : Linking.sendIntent('android.settings.SECURITY_SETTINGS').catch(() => Linking.openSettings())
              }
              isFirst={false}
              isLast
            />
          </View>

          {lock !== 'none' && (
            <>
              {sectionTitle(locked ? t('profiles.newPinSection') : t('profiles.pin'))}
              {pinField(locked ? t('profiles.newPinOptional') : t('profiles.fourDigitPin'), pin, setPin)}
              {pinField(locked ? t('profiles.confirmNewPin') : t('profiles.confirmPin'), pinConfirmation, setPinConfirmation, { onSubmitEditing: save })}
              <Text variant="bodySmall" style={[styles.help, { color: theme.colors.onSurfaceVariant }]}>
                {locked
                  ? t('profiles.keepCurrentPin')
                  : t('profiles.noRecovery')}
              </Text>
            </>
          )}

          {locked && !isOpen && (
            <Button onPress={forgotPin} style={styles.forgot}>{t('profiles.forgotPin')}</Button>
          )}
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  save: {
    marginRight: space.md,
  },
  content: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xxl,
  },
  column: {
    width: '100%',
    maxWidth: readingWidth,
    alignSelf: 'center',
  },
  sectionTitle: {
    marginTop: space.xl,
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
  field: {
    marginTop: space.sm,
  },
  help: {
    marginTop: space.sm,
    marginLeft: space.xs,
  },
  choice: {
    overflow: 'hidden',
  },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    minHeight: 72,
    paddingVertical: space.md,
    paddingLeft: space.lg,
    paddingRight: space.xl,
  },
  choiceGap: {
    marginBottom: 2,
  },
  choiceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: {
    flex: 1,
  },
  // A drawn radio button: Paper's RadioButton is a separate touch target, and here the whole row is the target.
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  forgot: {
    alignSelf: 'flex-start',
    marginTop: space.lg,
  },
});

export default ProfileLockScreen;
