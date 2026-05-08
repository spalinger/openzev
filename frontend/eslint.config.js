import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: './api',
            message: 'Import from a domain module (./api/auth, ./api/zev, ./api/metering, ./api/invoices, ./api/tariffs) instead of the legacy barrel.',
          },
          {
            name: '../api',
            message: 'Import from a domain module (../api/auth, ../api/zev, ../api/metering, ../api/invoices, ../api/tariffs) instead of the legacy barrel.',
          },
          {
            name: '../lib/api',
            message: 'Import from domain modules under ../lib/api/* instead of the legacy barrel ../lib/api.',
          },
          {
            name: '../../lib/api',
            message: 'Import from domain modules under ../../lib/api/* instead of the legacy barrel ../../lib/api.',
          },
          {
            name: '../../../lib/api',
            message: 'Import from domain modules under ../../../lib/api/* instead of the legacy barrel ../../../lib/api.',
          },
        ],
      }],
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
