FE_DIR=/Users/khanglp/Documents/devzone/staging/2k/www

# Hàm tạo timestamp yyyymmdd_HHMMSS
TIMESTAMP := $(shell date +"%Y%m%d_%H%M%S")

# Nếu MSG không truyền từ CLI thì auto set theo timestamp
MSG ?= update_$(TIMESTAMP)


start: 
	yarn start

all:
	@echo "Available commands:"
	@echo "  make deploy MSG='your message'"
	@echo "  make dist"

# Build frontend dist-wh
dist:
	@echo "🚀 Running FE dist-wh..."
	@$(MAKE) -C $(FE_DIR) dist-wh

# Git add + commit + push + build FE
deploy:
	@echo "📌 Staging changes..."
	git add .
	@echo "📝 Commit message: $(MSG)"
	git commit -m "$(MSG)" || echo "⚠️ Nothing to commit"
	@echo "📡 Pushing to repo..."
	git push
	@echo "📦 Building FE..."
	@$(MAKE) -C $(FE_DIR) dist-wh
	@echo "🎉 DONE!"
