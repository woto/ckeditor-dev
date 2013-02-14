/**
 * @license Copyright (c) 2003-2013, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.html or http://ckeditor.com/license
 */

(function() {
	'use strict';

	var DTD = CKEDITOR.dtd,
		copy = CKEDITOR.tools.copy,
		trim = CKEDITOR.tools.trim;

	/**
	 * @class
	 */
	CKEDITOR.filter = function( editorOrRules ) {
		/**
		 * Whether custom {@link CKEDITOR.config#allowedContent} was set.
		 *
		 * @property {Boolean} customConfig
		 */

		/**
		 * Array of rules added by {@link #allow} method.
		 *
		 * Rules in this array are slightly modified version of those
		 * which were added.
		 *
		 * This property is useful for debugging issues with rules string parsing
		 * or for checking what rules were automatically added by editor features.
		 */
		this.allowedContent = [];

		/**
		 * Whether filter is disabled.
		 *
		 * To disable filter set {@link CKEDITOR.config#allowedContent} to `true`
		 * or use {@link #disable} method.
		 *
		 * @readonly
		 */
		this.disabled = false;

		/**
		 * Editor instance if not a standalone filter.
		 *
		 * @property {CKEDITOR.editor} [=null]
		 */
		this.editor = null;

		this._ = {
			// Optimized rules.
			rules: {},
			cachedTests: {}
		};

		if ( editorOrRules instanceof CKEDITOR.editor ) {
			var editor = this.editor = editorOrRules;
			this.customConfig = true;

			var allowedContent = editor.config.allowedContent;

			// Disable filter completely by setting config.allowedContent = true.
			if ( allowedContent === true ) {
				this.disabled = true;
				return;
			}

			if ( !allowedContent )
				this.customConfig = false;

			// Add editor's default rules.
			this.allow( 'p br', 1 );
			this.allow( allowedContent, 1 );
			this.allow( editor.config.extraAllowedContent, 1 );

			//
			// Add filter listeners to toHTML and toDataFormat events.
			//

			// Filter incoming "data".
			// Add element filter before htmlDataProcessor.dataFilter
			// when purifying input data to correct html.
			this._.toHtmlListener = editor.on( 'toHtml', function( evt ) {
				this.applyTo( evt.data.dataValue );
			}, this, null, 6 );

			// Filter outcoming "data".
			// Add element filter  after htmlDataProcessor.htmlFilter
			// when preparing output data HTML.
			this._.toDataFormatListener = editor.on( 'toDataFormat', function( evt ) {
				this.applyTo( evt.data.dataValue );
			}, this, null, 11 );
		}
		// Rules object passed in editorOrRules argument - initialize standalone filter.
		else {
			this.customConfig = false;
			this.allow( editorOrRules, 1 );
		}
	};

	CKEDITOR.filter.prototype = {
		/**
		 * Adds specified rules to the filter.
		 *
		 * @param {Object/String/CKEDITOR.style/Object[]/String[]/CKEDITOR.style[]} newRules
		 * @param {Boolean} [overrideCustom] By default this method will reject any rules
		 * if default {@link CKEDITOR.config#allowedContent} is defined. Pass `true`
		 * to force rules addition.
		 * @returns {Boolean} Whether rules were accepted.
		 */
		allow: function( newRules, overrideCustom ) {
			if ( this.disabled )
				return false;

			// Don't override custom user's configuration if not explicitly requested.
			if ( this.customConfig && !overrideCustom )
				return false;

			if ( !newRules )
				return false;

			// Clear cache, because new rules could change results of checks.
			this._.cachedChecks = {};

			var i, ret;

			if ( typeof newRules == 'string' )
				newRules = parseRulesString( newRules );
			else if ( newRules instanceof CKEDITOR.style )
				newRules = convertStyleToRules( newRules );
			else if ( CKEDITOR.tools.isArray( newRules ) ) {
				for ( i = 0; i < newRules.length; ++i )
					ret = this.allow( newRules[ i ], overrideCustom );
				return ret; // Return last status.
			}

			var groupName, rule,
				rulesToOptimize = [];

			for ( groupName in newRules ) {
				// { 'p h1': true } => { 'p h1': {} }.
				if ( typeof rule == 'boolean' )
					rule = {};
				// { 'p h1': func } => { 'p h1': { validate: func } }.
				else if ( typeof rule == 'function' )
					rule = { validate: rule };
				// Clone (shallow) rule, because we'll modify it later.
				else
					rule = copy( newRules[ groupName ] );

				// If this is not an unnamed rule ({ '$1' => { ... } })
				// move elements list to property.
				if ( groupName.charAt( 0 ) != '$' )
					rule.elements = groupName;

				// Save rule and remember to optimize it.
				this.allowedContent.push( rule );
				rulesToOptimize.push( rule );
			}

			optimizeRules( this._.rules, rulesToOptimize );

			return true;
		},

		/**
		 * Apply this filter to passed fragment or element. The result
		 * of filtering is DOM tree without disallowed content.
		 *
		 * @param {CKEDITOR.htmlParser.fragment/CKEDITOR.htmlParser.element} fragment Node to be filtered.
		 */
		applyTo: function( fragment ) {
			var toBeRemoved = [],
				filterFn = getFilterFunction( this, toBeRemoved );

			// Filter all children, skip root (fragment or editable-like wrapper used by data processor).
			fragment.forEach( filterFn, CKEDITOR.NODE_ELEMENT, true );

			var element,
				toBeChecked = [];

			// Remove elements in reverse order - from leaves to root, to avoid conflicts.
			while ( ( element = toBeRemoved.pop() ) )
				removeElement( element, toBeChecked );

			// Check elements that have been marked as invalid (e.g. li as child of body after ul has been removed).
			while ( ( element = toBeChecked.pop() ) ) {
				if ( element.parent &&
					element.parent.type != CKEDITOR.NODE_DOCUMENT_FRAGMENT &&
					!DTD[ element.parent.name ][ element.name ]
				)
					removeElement( element, toBeChecked );
			}
		},

		/**
		 * Check whether feature can be enabled. Unlike the {@link #addFeature}
		 * this method always checks the feature, even when default configuration
		 * for {@link CKEDITOR.config#allowedContent} is used.
		 *
		 * @param feature
		 * @param feature.allowedContent HTML that can be generated by this feature.
		 * @param feature.requiredContent Minimal HTML that this feature must be allowed to
		 * generate for it to be able to function at all.
		 * @returns {Boolean} Whether this feature can be enabled.
		 */
		checkFeature: function( feature ) {
			if ( this.disabled )
				return true;

			if ( !feature )
				return true;

			// Some features may want to register other feature.
			// E.g. button may return command bound to it.
			if ( feature.toFeature )
				feature = feature.toFeature( this.editor );

			return !feature.requiredContent || this.check( feature.requiredContent );
		},

		/**
		 * Disable allowed content filter.
		 */
		disable: function() {
			this.disabled = true;
			if ( this._.toHtmlListener )
				this._.toHtmlListener.removeListener();
			if ( this._.toDataFormatListener )
				this._.toDataFormatListener.removeListener();
		},

		/**
		 * Checks whether a feature can be enabled for the HTML restrictions in place
		 * for the current CKEditor instance, based on the HTML the feature might
		 * generate and the minimal HTML the feature needs to be able to generate.
		 *
		 * @param feature
		 * @param feature.allowedContent HTML that can be generated by this feature.
		 * @param feature.requiredContent Minimal HTML that this feature must be allowed to
		 * generate for it to be able to function at all.
		 * @returns {Boolean} Whether this feature can be enabled.
		 */
		addFeature: function( feature ) {
			if ( this.disabled )
				return true;

			if ( !feature )
				return true;

			// Some features may want to register other feature.
			// E.g. button may return command bound to it.
			if ( feature.toFeature )
				feature = feature.toFeature( this.editor );

			// If default configuration (will be checked inside #allow()),
			// then add allowed content rules.
			this.allow( feature.allowedContent );
			// If custom configuration, then check if required content is allowed.
			if ( this.customConfig && feature.requiredContent )
				return this.check( feature.requiredContent );

			return true;
		},

		/**
		 * Checks whether content defined in test argument is allowed
		 * by this filter.
		 *
		 * @param {String/CKEDITOR.style} test
		 * @returns {Boolean} Returns `true` if content is allowed.
		 */
		check: function( test ) {
			if ( this.disabled )
				return true;

			var element, result;

			if ( typeof test == 'string' ) {
				// Check if result of this check hasn't been already cached.
				if ( test in this._.cachedChecks )
					return this._.cachedChecks[ test ];

				// Create test element from string.
				element = mockElementFromString( test );
			} else
				// Create test element from CKEDITOR.style.
				element = mockElementFromStyle( test );

			// Make a deep copy.
			var clone = CKEDITOR.tools.clone( element ),
				toBeRemoved = [];

			// Filter clone of mocked element.
			getFilterFunction( this, toBeRemoved )( clone );

			// Element has been marked for removal.
			if ( toBeRemoved.length > 0 )
				result = false;
			// Compare only left to right, because clone may be only trimmed version of original element.
			else if ( !CKEDITOR.tools.objectCompare( element.attributes, clone.attributes, true ) )
				result = false;
			else
				result = true;

			// Cache result of this test - we can build cache only for string tests.
			if ( typeof test == 'string' )
				this._.cachedChecks[ test ] = result;

			return result;
		}
	};

	function applyRule( rule, element, status, isSpecific ) {
		var name = element.name;

		// This generic rule doesn't apply to this element - skip it.
		if ( !isSpecific && rule.elements && !rule.elements( name ) )
			return;

		// Optimalization - validate only if still invalid.
		if ( !status.valid ) {
			// If rule has validator and it accepts this element - make it valid.
			if ( rule.validate ) {
				if ( rule.validate( element ) )
					status.valid = !rule.propertiesOnly;
				// Return so attrs, styles and classes won't be validated.
				else
					return;
			}
			// If there's no validator make it valid anyway, because there exists a rule for this element.
			else
				// If propertiesOnly is true it will keep status.valid == false.
				// This way only element properties (styles, attrs, classes) will be validated.
				status.valid = !rule.propertiesOnly;
		}

		// Apply rule only when all attrs/styles/classes haven't been marked as valid.
		if ( !status.allAttributes ) {
			status.allAttributes = applyRuleToHash( rule.attributes, element.attributes, status.validAttributes );
		}
		if ( !status.allStyles ) {
			status.allStyles = applyRuleToHash( rule.styles, element.styles, status.validStyles );
		}
		if ( !status.allClasses ) {
			status.allClasses = applyRuleToArray( rule.classes, element.classes, status.validClasses );
		}
	}

	// Apply itemsRule to items (only classes are kept in array).
	// Push accepted items to validItems array.
	// Return true when all items are valid.
	function applyRuleToArray( itemsRule, items, validItems ) {
		if ( !itemsRule )
			return;

		// True means that all elements of array are accepted (the asterix was used for classes).
		if ( itemsRule === true )
			return true;

		for ( var i = 0, l = items.length, item; i < l; ++i ) {
			item = items[ i ];
			if ( !validItems[ item ] )
				validItems[ item ] = itemsRule( item );
		}

		return false;
	}

	function applyRuleToHash( itemsRule, items, validItems ) {
		if ( !itemsRule )
			return;

		if ( itemsRule === true )
			return true;

		for ( var name in items ) {
			if ( !validItems[ name ] )
				validItems[ name ] = itemsRule( name, items[ name ] );
		}

		return false;
	}

	// Convert CKEDITOR.style to filter's rule.
	function convertStyleToRules( style ) {
		var styleDef = style.getDefinition(),
			rules = {},
			rule,
			attrs = styleDef.attributes;

		rules[ styleDef.element ] = rule = {
			styles: styleDef.styles
		};

		if ( attrs ) {
			attrs = copy( attrs );
			rule.classes = attrs[ 'class' ] ? attrs[ 'class' ].split( /\s+/ ) : null
			rule.attributes = attrs;
		}

		return rules;
	}

	// Returns function that accepts {@link CKEDITOR.htmlParser.element}
	// and filters it basing on allowed content rules registered by
	// {@link #allow} method.
	//
	// @param {CKEDITOR.filter} that
	function getFilterFunction( that, toBeRemoved ) {
		// If filter function is cached we'll return function from different scope
		// than this, so we need to pass toBeRemoved array by reference.
		var privObj = that._;
		privObj.toBeRemoved = toBeRemoved;

		// Return cached function.
		if ( privObj.filterFunction )
			return privObj.filterFunction;

		var optimizedRules = privObj.rules,
			unprotectElementsNamesRegexp = /^cke:(object|embed|param|html|body|head|title)$/;

		// Return and cache created function.
		return privObj.filterFunction = function( element ) {
			var name = element.name;
			// Unprotect elements names previously protected by htmlDataProcessor
			// (see protectElementNames and protectSelfClosingElements functions).
			name = name.replace( unprotectElementsNamesRegexp, '$1' );

			var rules = optimizedRules.elements[ name ],
				genericRules = optimizedRules.generic,
				status = {
					// Whether any of rules accepted element.
					// If not - it will be stripped.
					valid: false,
					// Objects containing accepted attributes, classes and styles.
					validAttributes: {},
					validClasses: {},
					validStyles: {},
					// Whether all are valid.
					// If we know that all element's attrs/classes/styles are valid
					// we can skip their validation, to improve performance.
					allAttributes: false,
					allClasses: false,
					allStyles: false
				},
				i, l;

			// Early return - if there are no rules for this element (specific or generic), remove it.
			if ( !rules && !genericRules ) {
				privObj.toBeRemoved.push( element );
				return;
			}

			// Parse classes and styles if that hasn't been done by filter#check yet.
			if ( !element.styles )
				element.styles = CKEDITOR.tools.parseCssText( element.attributes.style || '', 1 );
			if ( !element.classes )
				element.classes = element.attributes[ 'class' ] ? element.attributes[ 'class' ].split( /\s+/ ) : [];

			if ( rules ) {
				for ( i = 0, l = rules.length; i < l; ++i )
					applyRule( rules[ i ], element, status, true );
			}

			if ( genericRules ) {
				for ( i = 0, l = genericRules.length; i < l; ++i )
					applyRule( genericRules[ i ], element, status, false );
			}

			// Finally, if after running all filter rules it still hasn't been allowed - remove it.
			if ( !status.valid ) {
				privObj.toBeRemoved.push( element );
				return;
			}

			// Update element's attributes based on status of filtering.
			updateElement( element, status );
		};
	}

	// Create pseudo element that will be passed through filter
	// to check if tested string is allowed.
	function mockElementFromString( str ) {
		var element = parseRulesString( str )[ '$1' ],
			styles = element.styles,
			classes = element.classes;

		element.name = element.elements;
		element.classes = classes = ( classes ? classes.split( /\s*,\s*/ ) : [] );
		element.styles = mockHash( styles );
		element.attributes = mockHash( element.attributes );

		if ( classes.length )
			element.attributes[ 'class' ] = classes.join( ' ' );
		if ( styles )
			element.attributes.style = CKEDITOR.tools.writeCssText( element.styles );

		return element;
	}

	// Create pseudo element that will be passed through filter
	// to check if tested style is allowed.
	function mockElementFromStyle( style ) {
		var styleDef = style.getDefinition(),
			styles = styleDef.styles || null,
			attrs = styleDef.attributes || {};

		if ( styles ) {
			styles = copy( styles );
			attrs.style = CKEDITOR.tools.writeCssText( styles );
		}

		var el = {
			name: styleDef.element,
			attributes: attrs,
			classes: attrs[ 'class' ] ? attrs[ 'class' ].split( /\s+/ ) : null,
			styles: styles
		};

		return el;
	}

	// Mock hash based on string.
	// 'a,b,c' => { a: 'test', b: 'test', c: 'test' }
	// Used to mock styles and attributes objects.
	function mockHash( str ) {
		// It may be a null or empty string.
		if ( !str )
			return {};

		var keys = str.split( /\s*,\s*/ ).sort(),
			obj = {}

		while ( keys.length )
			obj[ keys.shift() ] = 'test';

		return obj;
	}

	// Optimize rule's validators (for elements, styles, etc.).
	// If any of these validators is a wildcard return true,
	// what means that this rule is a priority.
	// It should be applied in the first order, because it will
	// mark many properties as valid without checking them,
	// so next rules will be able to skip them saving time.
	function optimizeValidators( rule ) {
		var validator,
			priority = false;

		for ( var i in { elements:1,styles:1,attributes:1,classes:1 } ) {
			if ( ( validator = rule[ i ] ) ) {
				rule[ i ] = validatorFunction( validator );
				if ( validator === true )
					priority = true;
			}
		}

		return priority;
	}

	// Add optimized version of rule to optimizedRules object.
	function optimizeRules( optimizedRules, rules ) {
		var elementsRules = optimizedRules.elements || {},
			genericRules = optimizedRules.generic || [],
			i, l, rule, elements, element, priority;

		for ( i = 0, l = rules.length; i < l; ++i ) {
			// Shallow copy. Do not modify original rule.
			rule = copy( rules[ i ] );

			// If elements list was explicitly defined,
			// add this rule for every defined element.
			if ( typeof rule.elements == 'string' ) {
				// Do not optimize rule.elements.
				elements = trim( rule.elements );
				delete rule.elements;
				priority = optimizeValidators( rule );

				// E.g. "*(xxx)[xxx]" - it's a generic rule that
				// validates properties only.
				if ( elements == '*' ) {
					rule.propertiesOnly = true;
					// Add priority rules at the beginning.
					genericRules[ priority ? 'unshift' : 'push' ]( rule );
				} else {
					elements = elements.split( /\s+/ );

					while ( ( element = elements.pop() ) ) {
						if ( !elementsRules[ element ] )
							elementsRules[ element ] = [ rule ];
						else
							elementsRules[ element ][ priority ? 'unshift' : 'push' ]( rule );
					}
				}
			} else {
				priority = optimizeValidators( rule );

				// Add priority rules at the beginning.
				genericRules[ priority ? 'unshift' : 'push' ]( rule );
			}
		}

		optimizedRules.elements = elementsRules;
		optimizedRules.generic = genericRules.length ? genericRules : null;
	}

	function parseRulesString( input ) {
			//              <   elements   ><                     styles, attributes and classes                      >< separator >
		var groupPattern = /^([a-z0-9*\s]+)((?:\s*{[\w\-,\s\*]+}\s*|\s*\[[\w\-,\s\*]+\]\s*|\s*\([\w\-,\s\*]+\)\s*){0,3})(?:;\s*|$)/i,
			match,
			props, styles, attrs, classes,
			rules = {},
			groupNum = 1;

		input = trim( input );

		while ( ( match = input.match( groupPattern ) ) ) {
			if ( ( props = match[ 2 ] ) ) {
				styles = parseProperties( props, 'styles' );
				attrs = parseProperties( props, 'attrs' );
				classes = parseProperties( props, 'classes' );
			} else
				styles = attrs = classes = null;

			// Add as an unnamed rule, because there can be two rules
			// for one elements set defined in string format.
			rules[ '$' + groupNum++ ] = {
				elements: match[ 1 ],
				classes: classes,
				styles: styles,
				attributes: attrs
			};

			// Move to the next group.
			input = input.slice( match[ 0 ].length );
		}

		return rules;
	}

	var groupsPatterns = {
		styles: /{([^}]+)}/,
		attrs: /\[([^\]]+)\]/,
		classes: /\(([^\)]+)\)/
	};

	function parseProperties( properties, groupName ) {
		var group = properties.match( groupsPatterns[ groupName ] );
		return group ? trim( group[ 1 ] ) : null;
	}

	// Update element object based on status of filtering.
	function updateElement( element, status ) {
		var validAttrs = status.validAttributes,
			validStyles = status.validStyles,
			validClasses = status.validClasses,
			attrs = element.attributes,
			styles = element.styles,
			origClasses = attrs[ 'class' ],
			origStyles = attrs.style,
			name,
			stylesArr = [],
			classesArr = [],
			internalAttr = /^data-cke-/;

		// Will be recreated later if any of styles/classes were passed.
		delete attrs.style;
		delete attrs[ 'class' ];

		if ( !status.allAttributes ) {
			// We can safely remove class and styles attributes because they will be serialized later.
			for ( name in attrs ) {
				// If not valid and not internal attribute delete it.
				if ( !validAttrs[ name ] && !internalAttr.test( name ) )
					delete attrs[ name ];
			}
		}

		if ( !status.allStyles ) {
			for ( name in styles ) {
				if ( validStyles[ name ] )
					stylesArr.push( name + ':' + styles[ name ] );
			}
			if ( stylesArr.length )
				attrs.style = stylesArr.sort().join( '; ' );
		}
		else if ( origStyles )
			attrs.style = origStyles;

		if ( !status.allClasses ) {
			for ( name in validClasses ) {
				if ( validClasses[ name ] )
					classesArr.push( name );
			}
			if ( classesArr.length )
				attrs[ 'class' ] = classesArr.sort().join( ' ' );
		}
		else if ( origClasses )
			attrs[ 'class' ] = origClasses;
	}

	// Create validator function based on multiple
	// accepted validator formats:
	// function, string ('a,b,c'), regexp, array (['a','b','c']) and object ({a:1,b:2,c:3})
	function validatorFunction( validator ) {
		if ( validator == '*' )
			return true;

		var type = typeof validator;
		if ( type == 'object' )
			type = validator.test ? 'regexp' :
				validator.push ? 'array' :
				type;

		switch ( type ) {
			case 'function':
				return validator;
			case 'string':
				var arr = trim( validator ).split( /\s*,\s*/ );
				return function( value ) {
					return CKEDITOR.tools.indexOf( arr, value ) > -1;
				};
			case 'regexp':
				return function( value ) {
					return validator.test( value );
				};
			case 'array':
				return function( value ) {
					return CKEDITOR.tools.indexOf( validator, value ) > -1;
				};
			case 'object':
				return function( value ) {
					return value in validator;
				};
		}
	}

	//
	// REMOVE ELEMENT ---------------------------------------------------------
	//

	// Checks whether node is allowed by DTD.
	function allowedIn( node, parentDtd ) {
		if ( node.type == CKEDITOR.NODE_ELEMENT )
			return parentDtd[ node.name ];
		if ( node.type == CKEDITOR.NODE_TEXT )
			return parentDtd[ '#' ];
		return true;
	}

	// Check whether all children will be valid in new context.
	// Note: it doesn't verify if text node is valid, because
	// new parent should accept them.
	function checkChildren( children, newParentName ) {
		var allowed = DTD[ newParentName ];

		for ( var i = 0, l = children.length, child; i < l; ++i ) {
			child = children[ i ];
			if ( child.type == CKEDITOR.NODE_ELEMENT && !allowed[ child.name ] )
				return false;
		}

		return true;
	}

	// Whether this is an inline element or text.
	function inlineNode( node ) {
		return node.type == CKEDITOR.NODE_TEXT ||
			node.type == CKEDITOR.NODE_ELEMENT && DTD.$inline[ node.name ];
	}

	// Try to remove element in the best possible way.
	//
	// @param {Array} toBeChecked After executing this function
	// this array will contain elements that should be checked
	// because they were marked as potentially in wrong context (e.g. li in body).
	function removeElement( element, toBeChecked ) {
		var name = element.name;

		if ( DTD.$empty[ name ] || !element.children.length )
			element.remove();
		else if ( DTD.$block[ name ] || name == 'tr' )
			stripElement( element, toBeChecked );
		else
			element.replaceWithChildren();
	}

	// Strip element, but leave its content.
	function stripElement( element, toBeChecked ) {
		var children = element.children;

		// First, check if element's children may be wrapped with <p>.
		// Ignore that <p> may not be allowed in element.parent.
		// This will be fixed when removing parent, because in all known cases
		// parent will was also marked to be removed.
		if ( checkChildren( children, 'p' ) ) {
			element.name = 'p';
			element.attributes = {};
			return;
		}

		var parent = element.parent,
			shouldAutoP = parent.type == CKEDITOR.NODE_DOCUMENT_FRAGMENT || parent.name == 'body',
			i, j, child, p, node,
			toBeRemoved = [];

		for ( i = children.length; i > 0; ) {
			child = children[ --i ];

			// If parent requires auto paragraphing and child is inline node,
			// insert this child into newly created paragraph.
			if ( shouldAutoP && inlineNode( child )  ) {
				if ( !p ) {
					p = new CKEDITOR.htmlParser.element( 'p' );
					p.insertAfter( element );
				}
				p.add( child, 0 );
			}
			// Child which doesn't need to be auto paragraphed.
			else {
				p = null;
				child.insertAfter( element );
				// If inserted into invalid context, mark it and check
				// after removing all elements.
				if ( parent.type != CKEDITOR.NODE_DOCUMENT_FRAGMENT &&
					child.type == CKEDITOR.NODE_ELEMENT &&
					!DTD[ parent.name ][ child.name ]
				)
					toBeChecked.push( child );
			}
		}

		// All children have been moved to element's parent, so remove it.
		element.remove();
	}

})();