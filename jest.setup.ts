jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
}));

// Jest Expo installs fetch through a lazy native getter that can initialize after teardown.
const unavailableFetch: typeof fetch = async () => {
  throw new Error('Tests must inject network clients instead of using global fetch.');
};
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  enumerable: true,
  value: unavailableFetch,
  writable: true,
});
