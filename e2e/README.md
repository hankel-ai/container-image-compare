# Contents of `ai/container-image-compare/e2e/README.md`
To run the tests manually, follow these steps:

1. Ensure you have Node.js and npm installed on your machine.
2. Install the necessary dependencies by running:
   npm install
3. To execute the tests, use the following command:
   npm test

This will run all the tests defined in the `tests` directory. Make sure to check the output for any failed tests and review the logs for details.

# Contents of `tests/cache-explorer.test.js`
const assert = require('assert');

describe('Cache Explorer Tests', () => {
    it('should have no horizontal scroll bars', () => {
        const cacheExplorer = document.querySelector('.cache-explorer');
        const overflowX = window.getComputedStyle(cacheExplorer).overflowX;
        assert.strictEqual(overflowX, 'hidden');
    });

    // Existing tests go here
});

# Contents of `.gitignore`
*.png
*.jpg
*.jpeg
*.gif
*.tmp
*.log
screenshots/