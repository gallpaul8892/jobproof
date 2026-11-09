/** Two projects (design 3.1, 9): "logic" runs in plain Node, "ui" uses the jest-expo preset + RNTL. */
module.exports = {
  projects: [
    {
      displayName: "logic",
      testEnvironment: "node",
      testMatch: ["<rootDir>/{config,test,src}/**/*.test.ts"],
      transform: { "\\.[jt]sx?$": ["babel-jest", { presets: ["babel-preset-expo"] }] },
    },
    {
      displayName: "ui",
      preset: "jest-expo",
      testMatch: ["<rootDir>/{app,src}/**/*.test.tsx"],
      setupFilesAfterEnv: ["<rootDir>/test/setup.ui.ts"],
    },
  ],
};
