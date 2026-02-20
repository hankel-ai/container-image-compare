const { expect } = require('chai');

describe('Cache Explorer Tests', () => {
    it('should not have horizontal scroll bars', () => {
        const cacheExplorer = document.querySelector('.cache-explorer');
        expect(cacheExplorer.scrollWidth).to.be.lessThan(cacheExplorer.clientWidth);
    });

    // Existing tests can be reviewed here
});

README.md
# Running Tests Manually

To run the tests manually, follow these steps:

1. Ensure you have the necessary dependencies installed. You can do this by running:
   ```
   npm install
   ```

2. To execute the tests, use the following command:
   ```
   npm test
   ```

This will run all the tests in the `tests` directory using the testing framework specified in your project.

.gitignore
*.log
*.tmp
*.screenshot.png
*.screenshot.jpg
*.screenshot.gif