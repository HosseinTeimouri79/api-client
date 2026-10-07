// Promise-based modal stack: `const result = await modals.open((close) => <MyDialog close={close} />)`.
let stack = [];
const subs = new Set();
let seq = 0;
const emit = () => subs.forEach((f) => f(stack));
export const modals = {
  subscribe: (f) => (subs.add(f), () => subs.delete(f)),
  get: () => stack,
  open(render) {
    return new Promise((resolve) => {
      const m = { id: ++seq, render, close: (v) => { stack = stack.filter((x) => x !== m); emit(); resolve(v); } };
      stack = [...stack, m];
      emit();
    });
  },
};
