FE_DIR=/Users/khanglp/Documents/devzone/staging/2k/www

# Hàm tạo timestamp yyyymmdd_HHMMSS
TIMESTAMP := $(shell date +"%Y%m%d_%H%M%S")

# Nếu MSG không truyền từ CLI thì auto set theo timestamp
MSG ?= update_$(TIMESTAMP)


start: 
	yarn start

dev: 
	yarn dev

main: 
	yarn main

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

export:
	@echo "Generating portable create.sh (text-only, UTF-8, skip binary) ..."
	@echo '#!/bin/bash' > ./create.sh
	@echo 'set -e' >> ./create.sh
	@echo 'APP_NAME="apps"' >> ./create.sh
	@echo 'echo "Recreating project: $$APP_NAME..."' >> ./create.sh
	@echo 'rm -rf "$$APP_NAME" && mkdir -p "$$APP_NAME" && cd "$$APP_NAME"' >> ./create.sh
	@echo '' >> ./create.sh

	@# Dùng shell script tạm để tránh lỗi pipe trong Makefile
	@bash -c ' \
		find . -type f \
		  ! -path "./node_modules/*" \
		  ! -path "./create.sh" \
		  ! -path "./apps*" \
		  ! -path "./.git/*" \
		  ! -name "package-lock.json" \
		  ! -name "*.png" ! -name "*.jpg" ! -name "*.jpeg" ! -name "*.gif" \
		  ! -name "*.webp" ! -name "*.svg" ! -name "*.ico" \
		  ! -name "*.pdf" ! -name "*.zip" ! -name "*.tar" ! -name "*.gz" \
		  ! -name "*.exe" ! -name "*.dll" ! -name "*.so" ! -name "*.dylib" \
		  ! -name "*.bin" ! -name "*.dat" \
		| while IFS= read -r file; do \
		  if file "$$file" 2>/dev/null | grep -qE "text|JSON|XML|UTF-8"; then \
		    rel_path=$$(echo "$$file" | sed "s|^\./||"); \
		    dir=$$(dirname "$$rel_path"); \
		    [ "$$dir" != "." ] && echo "mkdir -p \"$$dir\"" >> ./create.sh; \
		    echo "echo \"Creating $$rel_path...\"" >> ./create.sh; \
		    echo "cat > \"$$rel_path\" <<'"'"'EOF'"'"'" >> ./create.sh; \
		    sed "s/$$/\r/" "$$file" | sed "s/\r$$//" >> ./create.sh; \
		    echo "EOF" >> ./create.sh; \
		    echo "" >> ./create.sh; \
		  else \
		    echo "Skipping binary: $$file" >&2; \
		  fi; \
		done \
	'

	@echo 'chmod -R 755 .' >> ./create.sh
	@echo 'echo "Project recreated successfully!"' >> ./create.sh
	@chmod +x ./create.sh
	@echo "create.sh generated (text-only, UTF-8 safe)!"

deploy-app:
	@echo "📦 Building FE..."
	@$(MAKE) -C $(FE_DIR) dist-app
	@echo "🎉 DONE!"