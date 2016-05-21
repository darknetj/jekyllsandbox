.PHONY: help install server deploy clean
.DEFAULT_GOAL := help

help: ## This help menu
	@echo "Copperhead's Static Website Repository"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

install: ## Install the Ruby dependencies
	@echo "Remember that you need Ruby 2.1 or later, and the `bundler` gem installed & in your $PATH"
	bundle install

server: ## Host a local development server, with Jekyll building in watch mode
	cd source/ && bundle exec jekyll server

deploy: ## Push the commited changes on master to "production" git remote
	git push production master

clean:  ## Purge the generated website and asset cache
	rm -rf source/.jekyll-assests-cache/
	rm -rf source/_site/
