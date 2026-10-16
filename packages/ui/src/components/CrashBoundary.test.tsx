import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Text } from 'react-native';
import { renderUI } from '../test/render';
import { CrashBoundary } from './CrashBoundary';

let broken = true;
function Flaky() {
  if (broken) throw new Error('render failed for 0770 111 2233');
  return <Text testID="recovered">رجع</Text>;
}

describe('CrashBoundary', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    broken = true;
    // React logs the caught error; keep the test output quiet.
    spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  it('shows the friendly crash screen, reports once, and «جرّب مرة ثانية» mounts the screens again', () => {
    const capture = vi.fn();
    renderUI(
      <CrashBoundary reporter={{ capture }}>
        <Flaky />
      </CrashBoundary>,
    );
    expect(screen.getByTestId('crash-screen')).toBeTruthy();
    expect(screen.getByText('صار خلل بالتطبيق')).toBeTruthy();
    expect(screen.getByText('المشكلة من عدنا مو منك، وما ضاع شي من حسابك')).toBeTruthy();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]![1]).toMatchObject({ logger: 'boundary', handled: false });

    broken = false;
    fireEvent.click(screen.getByText('جرّب مرة ثانية'));
    expect(screen.getByTestId('recovered')).toBeTruthy();
    expect(screen.queryByTestId('crash-screen')).toBeNull();
  });

  it('takes the merchant app its own copy', () => {
    renderUI(
      <CrashBoundary title="عنوان" body="نص" retryLabel="عيد">
        <Flaky />
      </CrashBoundary>,
    );
    expect(screen.getByText('عنوان')).toBeTruthy();
    expect(screen.getByText('عيد')).toBeTruthy();
  });
});
