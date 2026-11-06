'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useGymActions } from '@/features/gyms/api';
import { errorMessage } from '@/lib/errors';
import { Button, Caption, Card, ErrorText, Heading, Screen, TextField } from '@/ui/components';
import { useTheme } from '@/ui/ThemeProvider';

/** Join a gym with its invite code, or start one. */
export default function GymJoinScreen() {
  useTheme();
  const router = useRouter();
  const actions = useGymActions();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const join = async () => {
    setJoinError(null);
    if (code.replace(/[^A-Za-z0-9]/g, '').length !== 8) return setJoinError('A gym code has 8 letters and numbers.');
    try {
      await actions.join(code);
      router.replace('/gym');
    } catch (caught) {
      setJoinError(errorMessage(caught));
    }
  };

  const create = async () => {
    setCreateError(null);
    if (name.trim().length < 3) return setCreateError('Give your gym a name of at least 3 characters.');
    try {
      await actions.create(name.trim(), city.trim());
      router.replace('/gym');
    } catch (caught) {
      setCreateError(errorMessage(caught));
    }
  };

  return (
    <Screen>
      <Card>
        <Heading>Join with a code</Heading>
        <TextField label="Gym code" value={code} onChangeText={(value) => setCode(value.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={9} placeholder="e.g. K7MRT4QX" />
        <ErrorText>{joinError}</ErrorText>
        <Button label="Join gym" icon="enter-outline" onPress={join} />
        <Caption>Ask your coach or a teammate for the code. Joining shows your name and ranked ratings to the gym.</Caption>
      </Card>
      <Card>
        <Heading>Or start your gym</Heading>
        <TextField label="Gym name" value={name} onChangeText={setName} maxLength={60} />
        <TextField label="City (optional)" value={city} onChangeText={setCity} maxLength={60} />
        <ErrorText>{createError}</ErrorText>
        <Button label="Start gym" icon="add" variant="secondary" onPress={create} />
        <Caption>You'll get a code to share. You can be in one gym at a time.</Caption>
      </Card>
    </Screen>
  );
}
