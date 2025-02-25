//=============================================================================
// RPG Maker MZ - iframe plugin
// 
// This plugin is licensed under Mozilla Public License 2.0
// The license allows you to use the plugin in any product, also commercial.
// https://www.mozilla.org/en-US/MPL/2.0/
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Shows/hides a separate webpage using an iframe.
 * @author jakubiszon
 *
 * @param debugMode
 * @text debugMode
 * @type boolean
 * @desc Makes the plugin print debug information to the console.
 * @default false
 *
 * @param useSimpleValues
 * @text useSimpleValues
 * @type boolean
 * @default false
 * @desc Makes the plugin pass a single value to the callback instead of an array.
 *       This will only work when the callback receives a single param.
 *       If multiple params are received - they will be passed as an array.
 * 
 * @help iframe.js
 *
 * This plugin allows showing other web-pages in an iframe over the game.
 * Use the "show" command with a single param specifying the page url.
 * To close the frame the game needs to call the "hide" command.
 * To know when to close the page - the plugin can setup a callback or
 * watch for updates in iframe data.
 *
 * TODO (PRs welcome! https://github.com/jakubiszon/rpg-maker-mz-iframe)
 * 1. Nested paths for callbackPath param
 * 2. Add width and height params to allow setting custom iframe size
 * 3. Add zIndex param
 *
 * @command show
 * @text show
 * @desc Displays a html page in an iframe and pauses the game until the page calls a callback or the game calls the "hide" command.
 *
 * @arg pageUrl
 * @type string
 * @text pageUrl
 * @desc Address of the page to show, relative to the index page e.g. "./page1.html"
 * 
 * @arg commonEvent
 * @type common_event
 * @text commonEvent
 * @desc (optional) Event called when the page sends a callback or its data is changed.
 * 
 * @arg outputVariable
 * @type variable
 * @text outputVariable
 * @desc (optional) Variable into which page data is stored.
 *       1) When callbackPath is specified and a callback is received - callback param array
 *          will be turned to json and placed in this variable.
 *       2) When watchPath is specified - the newest version of watched data
 *          will be turned to json and placed in this variable.
 *       3) After the above happens the commonEvent is fired or the page closed is no event is specified.
 *
 * @arg callbackPath
 * @type string
 * @text callbackPath
 * @desc (optional) The path of a callback to assign inside the embedded page.
 *       When a callback is received:
 *       1) If variable is specified - callback param array
 *          will be turned to json and placed in this variable.
 *       2) When commonEvent is specified - the event will be fired. OR
 *       3) When commonEvent not specified - the page will close.
 *       e.g. "gameCallback" will assign the callback method as "iframe.contentWindow.gameCallback"
 *       TODO: "someObj/callback" will assign the callback method as "iframe.contentWindow.someObj.callback"
 * 
 * @arg watchPath
 * @type string
 * @text watchPath
 * @desc (optional) The path to data inside the iframe which is tracked for changes.
 *       When data is changed the callback is received the specified commonEvent will be fired.
 *       If not commonEvent is specified - the page will just close.
 *       e.g. "gameCallback" will assign the callback method as "iframe.contentWindow.gameCallback"
 *       TODO: "someObj/someProperty" will watch "iframe.contentWindow.someObj.someProperty"
 * 
 * @command hide
 * @text hide
 * @desc Removes the current iframe if it was set-up or does nothing.
 */

/** @class SystemData stores data about enabled parts of the $gameSystem. */
class systemData {
	isMenuEnabled = false;
	isSaveEnabled = false;
}

class iframeData {
	/**
	 * Stores data about enabled parts of the $gameSystem.
	 * @type { systemData | null }
	 */
	systemData = new systemData();

	/** Stores the value returned from window.setInterval, only used when watchPath is defined. */
	watchIntervalId = null;
}

(function() {
	const pluginName = 'iframe';
	const containerId = `${pluginName}-container`;
	const pluginParameters = getParameters();
	logDebugInfo( `plugin ${pluginName} assigned parameters: `, pluginParameters );

	/** @constant {number} zIndex used for the iframe shown by this plugin. */
	const zIndex = 10;

	/** stores data needed in any callback after creation of the iframe */
	let currentIframeData = {};

	PluginManager.registerCommand( pluginName, "hide", hidePage );
	PluginManager.registerCommand( pluginName, "show", showPage );

	/**
	 * Returns plugin parameters with boolean values converted to actual booleans.
	 */
	function getParameters(){
		let tmpParameters = PluginManager.parameters( 'iframe' );
		return {
			...tmpParameters,
			debugMode: tmpParameters.debugMode === 'true',
			useSimpleValues: tmpParameters.useSimpleValues === 'true'
		};
	}

	function showPage ( args ) {
		logDebugInfo( 'show command', args );
		if( document.getElementById( containerId )) {
			logDebugInfo( 'show command - ignored call, elements already exist' );
			return;
		}

		const pageUrl = String( args.pageUrl );
		if( !pageUrl ) {
			console.error( `${pluginName}:show requires an attribute *pageUrl*` );
			return;
		}

		// no iframe created yet
		currentIframeData.args = args;
		disableMenuAndSave();

		let iframe = createIframe( pageUrl );
		let container = createContainer();
		container.appendChild( iframe );
		document.body.insertAdjacentElement( 'beforeend', container );

		updateScale();
		window.addEventListener( "resize", updateScale );
		window.addEventListener( "focus", focusOnIframe );
		window.addEventListener( "message", iframeCallback );

		iframe.onload = function() {
			iframe.focus();
			
			if( !!args.callbackPath ) {
				iframe.contentWindow[ args.callbackPath ] = iframeCallback;
			}
			
			if( !!args.watchPath ) {
				currentIframeData.watchIntervalId = window.setInterval( watchCallback, 166 );
				logDebugInfo( 'setting up watch callback as timeout: ' + currentIframeData.watchIntervalId );
			}
		}
	}

	/**
	 * Hides the page and restores app state
	 */
	function hidePage() {
		logDebugInfo( 'hide command' );

		restoreMenuAndSave()

		let containerElement = document.getElementById( containerId );
		if( !containerElement ) return;
		
		containerElement.parentElement.removeChild( containerElement );

		if( currentIframeData.watchIntervalId ) window.clearInterval( currentIframeData.watchIntervalId );

		// reset iframe data
		currentIframeData = {};

		window.removeEventListener( "resize", updateScale );
		window.removeEventListener( "focus", focusOnIframe );
		window.removeEventListener( "message", iframeCallback );
		window.focus();
	}

	/**
	 * Creates an iframe html element with all the necessary properties.
	 * @param {string} pageUrl
	 * @returns {HTMLIFrameElement} iframe element ready to be inserted into the DOM.
	 */
	function createIframe( pageUrl ) {
		let iframe = document.createElement( 'iframe' );
		iframe.style.height = '600px';
		iframe.style.width = '800px';
		iframe.style.transformOrigin = 'center';
		iframe.style.borderStyle = 'none';
		iframe.style.overflow = 'hidden';
		iframe.src = pageUrl;
		return iframe;
	}

	/**
	 * Creates a div containing the iframe. The div should always cover the entire width and height of the page.
	 * @returns {HTMLDivElement}
	 */
	function createContainer() {
		let container = document.createElement( 'div' );
		container.style.position = 'absolute';
		container.style.display = 'flex';
		container.style.zIndex = zIndex;
		container.style.top =  '0';
		container.style.left = '0';
		container.style.height = '100vh';
		container.style.width = '100vw';
		container.style.justifyContent = 'center';
		container.style.alignItems = 'center';
		container.style.backgroundColor = 'transparent'; //'#773';
		container.id = containerId;
		return container;
	}

	/**
	 * Updates the width and height of the iframe to fit either the full width or the full height of the game window.
	 */
	function updateScale() {
		const container = document.getElementById( containerId );
		if( !container ) return;

		const iframe = container.querySelector( 'iframe' );
		const baseWidth = 800; // element.style.width without px
		const baseHeight = 600;
		
		const windowWidth = window.innerWidth;
		const windowHeight = window.innerHeight;

		const scale = Math.min( windowWidth / baseWidth, windowHeight / baseHeight );

		iframe.style.transform = `scale(${scale})`;

		logDebugInfo('window.onresize called', {
			windowWidth,
			windowHeight,
			scale
		});
	}

	/**
	 * Sets the focus on the iframe window.
	 */
	function focusOnIframe() {
		document.getElementById( containerId ).querySelector( 'iframe' ).focus();
	}

	function disableMenuAndSave() {
		currentIframeData.systemData = {
			isSaveEnabled: $gameSystem.isSaveEnabled(),
			isMenuEnabled: $gameSystem.isMenuEnabled(),
		}

		logDebugInfo( 'storing feature enablement data', currentIframeData.systemData );
		
		$gameSystem.disableSave();
		$gameSystem.disableMenu();
	}

	/**
	 * Restores menu and save enablement statuses which were recorded when setting up the iframe.
	 */
	function restoreMenuAndSave() {
		if( currentIframeData.systemData?.isSaveEnabled ) $gameSystem.enableSave();
		if( currentIframeData.systemData?.isMenuEnabled ) $gameSystem.enableMenu();

		currentIframeData.systemData = null;
	}
	
	/**
	 * Used as a callback assigned to the child window.
	 * @this {object} args of the show command binded as the object of this method.
	 */
	function iframeCallback() {
		logDebugInfo( 'callback called', arguments );

		if( !!currentIframeData.args.outputVariable ) {
			let varialeString = (pluginParameters.useSimpleValues && arguments.length === 1) ?
				JSON.stringify( arguments[0] ) :
				JSON.stringify( arguments );

			logDebugInfo( `callback - setting variable ${currentIframeData.args.outputVariable} as ${varialeString}.` );
			$gameVariables.setValue(currentIframeData.args.outputVariable, JSON.stringify(arguments));
		}

		if( !!currentIframeData.args.commonEvent ) {
			logDebugInfo( 'callback - calling event ' + currentIframeData.args.commonEvent );
			$gameTemp.reserveCommonEvent( parseInt( currentIframeData.args.commonEvent ));
		} else {
			logDebugInfo( 'callback - closing page ' );
			hidePage();
		}
	}

	/**
	 * Used as a callback used to check if data has updated.
	 * @this {object} args of the show command binded as the object of this method.
	 */
	function watchCallback() {
		const container = document.getElementById( containerId );
		if( !container ) return;

		let parts = currentIframeData.args.watchPath.split('/').filter(part => !!part);
		let variable = container.querySelector( 'iframe' ).contentWindow;
		for( const part of parts ) {
			if( variable == null ) break;
			variable = variable[ part ];
		}

		if( !Object.prototype.hasOwnProperty.call( currentIframeData, 'watchValue' )) {
			logDebugInfo( 'watch - first assignment' );
			currentIframeData.watchValue = variable;
			return;
		}

		if( JSON.stringify(variable) != JSON.stringify( currentIframeData.watchValue )) {
			logDebugInfo( 'watch - detected change' );
			iframeCallback( variable );
			currentIframeData.watchValue = variable;
		}
	}
	
	function logDebugInfo( name, data ) {
		if( !pluginParameters.debugMode ) return;
		
		if( !!data ) {
			console.log( name, data );
		} else {
			console.log( name );
		}
	}

})();
