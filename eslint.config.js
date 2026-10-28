const js = require("@eslint/js");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        process: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setImmediate: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        fetch: "readonly",
        structuredClone: "readonly",
        FormData: "readonly",
        Blob: "readonly"
      }
    },
    rules: {
      "brace-style": ["error", "allman"],
      "keyword-spacing": ["error", {
        "overrides": {
          "if": { "after": false },
          "for": { "after": false },
          "while": { "after": false },
          "switch": { "after": false },
          "catch": { "after": false }
        }
      }],
      "no-unused-vars": "off",
      "no-useless-assignment": "off",
      "no-unsafe-finally": "off"
    }
  }
];
