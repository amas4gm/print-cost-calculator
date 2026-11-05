# AMAS Print Cost Calculator

Static calculator for machine printing and labor services. No build step, external scripts, or server required.

## Use

Add named jobs, choose a machine or Labor only, and enter the applicable costs and time. Labor uses entered minutes / 60 multiplied by the entered hourly rate. Labor jobs support an optional extended description. Jobs can be edited or removed from a combined bill. Print the saved bill using the print button.

Jobs exist only in the current browser tab; reloading or closing clears them. No job data is transmitted or persisted.

## Configuration

`pricing.xml` supplies machine names, descriptions, icons and all pricing. Keep the XML, JavaScript, HTML, styles and assets together. Asset paths are relative for GitHub Pages project sites.

Each profile can declare `capabilities` with `material`, `printTime` and `maintenance` boolean attributes, `labor` set to disabled, optional or required, and optional `extendedDescription="true"`. Missing capabilities preserve legacy machine behavior. Invalid configuration blocks estimates without a fallback price list.

## Local preview and checks

Run `python -m http.server 8765 --bind 127.0.0.1` in this directory. Open the local server, then `/tests/` for browser regression checks or `/tests/?invoice` for the sample invoice. The suite covers original machine prices, XML validation, icon loading, keyboard selection, mixed bills, editing, labor-only inputs, descriptions and invoice presentation. Physical printer and OS PDF pagination are not covered.

## GitHub Pages

Publish the `main` branch from `/ (root)` in repository Settings > Pages. `.nojekyll` keeps the site buildless. No custom domain or third-party service is required.
