.PHONY: setup scrape test-telegram

setup:
	npm install
	npx playwright install --with-deps

scrape:
	npm run scrape
	echo "Counts + titles logged above."

test-telegram:
	npm run test:telegram
