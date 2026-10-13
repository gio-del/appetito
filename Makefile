# appetito development targets. Everything heavy runs in containers.
GITLEAKS ?= zricethezav/gitleaks:v8.18.4
SHELLCHECK ?= koalaman/shellcheck:v0.10.0

.PHONY: check personal secrets lint test e2e

check: personal secrets lint

personal:
	scripts/check-personal

secrets:
	docker run --rm -v "$(CURDIR):/repo:ro" $(GITLEAKS) detect --source /repo --no-banner --redact

# Every shell script tracked in the repo (shebang sh/bash).
lint:
	@files=$$(git ls-files | while read -r f; do [ -f "$$f" ] && head -c 64 "$$f" | grep -qE '^#!.*\b(ba)?sh\b' && echo "$$f"; done); \
	if [ -n "$$files" ]; then docker run --rm -v "$(CURDIR):/mnt:ro" -w /mnt $(SHELLCHECK) -S warning $$files; fi

test:
	tests/run-unit

e2e:
	tests/e2e/run $(E2E_ARGS)
