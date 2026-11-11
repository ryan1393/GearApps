import { CountStepperComponent } from './count-stepper.component';

describe('CountStepperComponent', () => {
  it('keeps − and + within the allowed range', () => {
    const stepper = new CountStepperComponent();
    stepper.min = 0;
    stepper.max = 3;
    const emitted: number[] = [];
    stepper.valueChange.subscribe((value) => emitted.push(value));
    stepper.set(-1);
    stepper.set(4);
    stepper.set(2.7);
    stepper.set(Number.NaN);
    expect(emitted).toEqual([0, 3, 2, 0]);
  });
});
