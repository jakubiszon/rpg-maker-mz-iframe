# iframe plugin for RPG Maker MZ

This plugin allows:
1. showing html page(s) in an iframe, one at a time
2. receiving callbacks triggered by the page
3. reacting to state changes in the page

[Live Demo](http://example.com) with PICO-8 and Pocket Platformer.

## Plugin Commands

1. ### `show` - shows a page in an iframe
   It can be called multiple times but only the first call will have effect.
   This command takes multiple [parameters documented in the code](./iframe.js).

1. ### `hide` - hides the iframe
   Takes no arguments, closes the iframe, can be called multiple times.

## Known Issues
At the moment in some scenarios (e.g. when the window is resized) it is possible to deliver some events to the main window. This can move the character while the
iframe is being displayed.

The problem can be mitigated with:
- fade the screen out
- transfer the player to a location restricting their movement
- show iframe
- hide the iframe when your conditions are met
- transfer the player back to map
- fade the sceen in

If you know of a better workaround - let me know. Or maybe open a PR :D

## Integrating with Pocket Platformer
You will need to use [Pocket Platformer integration fork](https://jakubiszon.github.io/pocket-platformer/).
If you already have a game you want to use - you only need to import it and export using.


## Integrating with PICO-8

You will need to export your pico cartridge as a html page.
For the moment only the js (no WASM) version was tested.

In order for a PICO-8 card to pass data to javascript it needs to
call the `poke` function for address range 

Also make sure your exported `.html` page has the following setting:
```
var p8_autoplay = true;
```

