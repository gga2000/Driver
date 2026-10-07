import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Art, Button, Card, Text, useTheme, type ArtName, type ButtonVariant } from '@driver/ui';

/** The picture's side on a quiet card: big enough to read at a glance, small enough to sit beside two lines. */
export const QUIET_PICTURE = 88;

export interface QuietCardProps {
  testID: string;
  /** One of Ali's approved state pictures. */
  art: ArtName;
  /** Drawn over the picture, in its box (the night card's twinkling stars). */
  overlay?: ReactNode;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void; variant?: ButtonVariant; testID?: string };
}

/**
 * Home's quiet moments (Ali's locked pictures, 2026-10-07): kitchens closed for the night, no internet
 * and nothing cached, no kitchen open here, no place picked yet. The picture sits beside a title and
 * one line, with at most one button under them. The picture is decoration; screen readers hear the
 * title and the line.
 */
export function QuietCard({ testID, art, overlay, title, body, action }: QuietCardProps) {
  const theme = useTheme();
  return (
    <Card lift padding={4} testID={testID}>
      <View style={{ gap: theme.space[4] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ width: QUIET_PICTURE, height: QUIET_PICTURE }}>
            <Art name={art} size={QUIET_PICTURE} testID={`${testID}-art`} />
            {overlay}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: theme.space[1] }}>
            <Text variant="title" face="display">
              {title}
            </Text>
            {body ? (
              <Text variant="footnote" color="textMuted">
                {body}
              </Text>
            ) : null}
          </View>
        </View>
        {action ? <Button label={action.label} variant={action.variant ?? 'primary'} onPress={action.onPress} testID={action.testID} /> : null}
      </View>
    </Card>
  );
}
