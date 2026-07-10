# Contributing to Zone

We welcome contributions from the community. Here is how you can help.

## Development Workflow

```
Fork Repository → Create Branch → Make Changes → Test Changes → Commit & Push → Open Pull Request
```

## Step-by-Step Guide

1. **Fork the repository** on GitHub
2. **Create a feature branch**: `git checkout -b feat/amazing-feature`
3. **Make your changes** following the development guidelines below
4. **Test your changes** — ensure existing functionality is not broken
5. **Commit your changes**: `git commit -m 'feat: add amazing feature'`
6. **Push to the branch**: `git push origin feat/amazing-feature`
7. **Open a Pull Request** with a clear description of your changes

## Development Guidelines

| Area | Convention |
|:---|---|
| **JavaScript** | All frontend code goes in `app/static/js/app.js`. Uses IIFE module pattern with strict mode. No external dependencies beyond Chart.js and html2canvas. |
| **CSS** | All styles go in `app/static/css/main.css`. Uses CSS custom properties for theming. Responsive breakpoints at 1024px (tablet) and 640px (mobile). Respects `prefers-reduced-motion`. |
| **Python API** | New endpoints go in `app/main.py` with Pydantic models for request/response validation. |
| **Sync Module** | Changes to cloud sync logic go in `app/sync.py`. |
| **Commit Messages** | Use conventional commit format: `type: description` (e.g., `feat:`, `fix:`, `refactor:`, `docs:`, `style:`). |

## Code Style

- JavaScript: Single quotes, 2-space indentation, semicolons, strict mode
- Python: Follow PEP 8, type hints for all function signatures
- CSS: Alphabetical property ordering, custom properties for theme values

## Pull Request Process

1. Update the README.md with details of changes if applicable
2. Update any relevant API documentation
3. The PR should work on the existing deployment platform (HF Spaces / Docker)
4. PRs require at least one review before merging

## Reporting Issues

When reporting bugs, include:

- Browser and OS version
- Steps to reproduce
- Expected vs actual behavior
- Console errors (if any)
- Screenshots (if applicable)

## Feature Requests

Open an issue with the `enhancement` tag and describe:

- What problem the feature solves
- How the feature should work
- Any alternative solutions considered

## Code of Conduct

Be respectful and constructive. Harassment, trolling, and personal attacks are not tolerated.
