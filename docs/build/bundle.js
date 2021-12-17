var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }

    // Track which nodes are claimed during hydration. Unclaimed nodes can then be removed from the DOM
    // at the end of hydration without touching the remaining nodes.
    let is_hydrating = false;
    function start_hydrating() {
        is_hydrating = true;
    }
    function end_hydrating() {
        is_hydrating = false;
    }
    function upper_bound(low, high, key, value) {
        // Return first index of value larger than input value in the range [low, high)
        while (low < high) {
            const mid = low + ((high - low) >> 1);
            if (key(mid) <= value) {
                low = mid + 1;
            }
            else {
                high = mid;
            }
        }
        return low;
    }
    function init_hydrate(target) {
        if (target.hydrate_init)
            return;
        target.hydrate_init = true;
        // We know that all children have claim_order values since the unclaimed have been detached
        const children = target.childNodes;
        /*
        * Reorder claimed children optimally.
        * We can reorder claimed children optimally by finding the longest subsequence of
        * nodes that are already claimed in order and only moving the rest. The longest
        * subsequence subsequence of nodes that are claimed in order can be found by
        * computing the longest increasing subsequence of .claim_order values.
        *
        * This algorithm is optimal in generating the least amount of reorder operations
        * possible.
        *
        * Proof:
        * We know that, given a set of reordering operations, the nodes that do not move
        * always form an increasing subsequence, since they do not move among each other
        * meaning that they must be already ordered among each other. Thus, the maximal
        * set of nodes that do not move form a longest increasing subsequence.
        */
        // Compute longest increasing subsequence
        // m: subsequence length j => index k of smallest value that ends an increasing subsequence of length j
        const m = new Int32Array(children.length + 1);
        // Predecessor indices + 1
        const p = new Int32Array(children.length);
        m[0] = -1;
        let longest = 0;
        for (let i = 0; i < children.length; i++) {
            const current = children[i].claim_order;
            // Find the largest subsequence length such that it ends in a value less than our current value
            // upper_bound returns first greater value, so we subtract one
            const seqLen = upper_bound(1, longest + 1, idx => children[m[idx]].claim_order, current) - 1;
            p[i] = m[seqLen] + 1;
            const newLen = seqLen + 1;
            // We can guarantee that current is the smallest value. Otherwise, we would have generated a longer sequence.
            m[newLen] = i;
            longest = Math.max(newLen, longest);
        }
        // The longest increasing subsequence of nodes (initially reversed)
        const lis = [];
        // The rest of the nodes, nodes that will be moved
        const toMove = [];
        let last = children.length - 1;
        for (let cur = m[longest] + 1; cur != 0; cur = p[cur - 1]) {
            lis.push(children[cur - 1]);
            for (; last >= cur; last--) {
                toMove.push(children[last]);
            }
            last--;
        }
        for (; last >= 0; last--) {
            toMove.push(children[last]);
        }
        lis.reverse();
        // We sort the nodes being moved to guarantee that their insertion order matches the claim order
        toMove.sort((a, b) => a.claim_order - b.claim_order);
        // Finally, we move the nodes
        for (let i = 0, j = 0; i < toMove.length; i++) {
            while (j < lis.length && toMove[i].claim_order >= lis[j].claim_order) {
                j++;
            }
            const anchor = j < lis.length ? lis[j] : null;
            target.insertBefore(toMove[i], anchor);
        }
    }
    function append(target, node) {
        if (is_hydrating) {
            init_hydrate(target);
            if ((target.actual_end_child === undefined) || ((target.actual_end_child !== null) && (target.actual_end_child.parentElement !== target))) {
                target.actual_end_child = target.firstChild;
            }
            if (node !== target.actual_end_child) {
                target.insertBefore(node, target.actual_end_child);
            }
            else {
                target.actual_end_child = node.nextSibling;
            }
        }
        else if (node.parentNode !== target) {
            target.appendChild(node);
        }
    }
    function insert(target, node, anchor) {
        if (is_hydrating && !anchor) {
            append(target, node);
        }
        else if (node.parentNode !== target || (anchor && node.nextSibling !== anchor)) {
            target.insertBefore(node, anchor || null);
        }
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function to_number(value) {
        return value === '' ? null : +value;
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_input_value(input, value) {
        input.value = value == null ? '' : value;
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail);
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
            }
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function add_flush_callback(fn) {
        flush_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }

    function bind(component, name, callback) {
        const index = component.$$.props[name];
        if (index !== undefined) {
            component.$$.bound[index] = callback;
            callback(component.$$.ctx[index]);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : options.context || []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                start_hydrating();
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            end_hydrating();
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.38.3' }, detail)));
    }
    function append_dev(target, node) {
        dispatch_dev('SvelteDOMInsert', { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation) {
        const modifiers = options === true ? ['capture'] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        dispatch_dev('SvelteDOMAddEventListener', { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev('SvelteDOMRemoveEventListener', { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev('SvelteDOMRemoveAttribute', { node, attribute });
        else
            dispatch_dev('SvelteDOMSetAttribute', { node, attribute, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.wholeText === data)
            return;
        dispatch_dev('SvelteDOMSetData', { node: text, data });
        text.data = data;
    }
    function validate_each_argument(arg) {
        if (typeof arg !== 'string' && !(arg && typeof arg === 'object' && 'length' in arg)) {
            let msg = '{#each} only iterates over array-like objects.';
            if (typeof Symbol === 'function' && arg && Symbol.iterator in arg) {
                msg += ' You can use a spread to convert this iterable into an array.';
            }
            throw new Error(msg);
        }
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    var img$5 = "data:image/png;base64,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";

    var RoutingLocation;
    (function (RoutingLocation) {
        RoutingLocation[RoutingLocation["Home"] = 1] = "Home";
        RoutingLocation[RoutingLocation["NPPaperStudies"] = 2] = "NPPaperStudies";
    })(RoutingLocation || (RoutingLocation = {}));

    const subscriber_queue = [];
    /**
     * Create a `Writable` store that allows both updating and reading by subscription.
     * @param {*=}value initial value
     * @param {StartStopNotifier=}start start and stop notifications for subscriptions
     */
    function writable(value, start = noop) {
        let stop;
        const subscribers = [];
        function set(new_value) {
            if (safe_not_equal(value, new_value)) {
                value = new_value;
                if (stop) { // store is ready
                    const run_queue = !subscriber_queue.length;
                    for (let i = 0; i < subscribers.length; i += 1) {
                        const s = subscribers[i];
                        s[1]();
                        subscriber_queue.push(s, value);
                    }
                    if (run_queue) {
                        for (let i = 0; i < subscriber_queue.length; i += 2) {
                            subscriber_queue[i][0](subscriber_queue[i + 1]);
                        }
                        subscriber_queue.length = 0;
                    }
                }
            }
        }
        function update(fn) {
            set(fn(value));
        }
        function subscribe(run, invalidate = noop) {
            const subscriber = [run, invalidate];
            subscribers.push(subscriber);
            if (subscribers.length === 1) {
                stop = start(set) || noop;
            }
            run(value);
            return () => {
                const index = subscribers.indexOf(subscriber);
                if (index !== -1) {
                    subscribers.splice(index, 1);
                }
                if (subscribers.length === 0) {
                    stop();
                    stop = null;
                }
            };
        }
        return { set, update, subscribe };
    }

    const routingStore = writable(RoutingLocation.NPPaperStudies);

    /* src/components/home.svelte generated by Svelte v3.38.3 */
    const file$5 = "src/components/home.svelte";

    function create_fragment$6(ctx) {
    	let div4;
    	let img;
    	let img_src_value;
    	let t0;
    	let div0;
    	let t2;
    	let div1;
    	let t4;
    	let div2;
    	let t5;
    	let button0;
    	let t7;
    	let div3;
    	let t8;
    	let button1;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			div4 = element("div");
    			img = element("img");
    			t0 = space();
    			div0 = element("div");
    			div0.textContent = "MAPLE";
    			t2 = space();
    			div1 = element("div");
    			div1.textContent = "A process model simulator for exploring cascaded architectures.";
    			t4 = space();
    			div2 = element("div");
    			t5 = space();
    			button0 = element("button");
    			button0.textContent = "Studies for Neuropsychology Paper";
    			t7 = space();
    			div3 = element("div");
    			t8 = space();
    			button1 = element("button");
    			button1.textContent = "Source code available on github";
    			attr_dev(img, "class", "image svelte-1m91a9j");
    			if (img.src !== (img_src_value = img$5)) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "alt", "the maple leaf is used as the icon for the maple program");
    			add_location(img, file$5, 13, 4, 448);
    			attr_dev(div0, "class", "title");
    			add_location(div0, file$5, 18, 4, 581);
    			attr_dev(div1, "class", "subtitle");
    			add_location(div1, file$5, 19, 4, 616);
    			attr_dev(div2, "class", "separator svelte-1m91a9j");
    			add_location(div2, file$5, 22, 4, 726);
    			attr_dev(button0, "class", "selectionButton svelte-1m91a9j");
    			add_location(button0, file$5, 23, 4, 756);
    			attr_dev(div3, "class", "separator svelte-1m91a9j");
    			add_location(div3, file$5, 26, 4, 881);
    			attr_dev(button1, "class", "selectionButton svelte-1m91a9j");
    			add_location(button1, file$5, 27, 4, 911);
    			attr_dev(div4, "class", "content svelte-1m91a9j");
    			add_location(div4, file$5, 12, 0, 422);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div4, anchor);
    			append_dev(div4, img);
    			append_dev(div4, t0);
    			append_dev(div4, div0);
    			append_dev(div4, t2);
    			append_dev(div4, div1);
    			append_dev(div4, t4);
    			append_dev(div4, div2);
    			append_dev(div4, t5);
    			append_dev(div4, button0);
    			append_dev(div4, t7);
    			append_dev(div4, div3);
    			append_dev(div4, t8);
    			append_dev(div4, button1);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", /*studiesButtonClicked*/ ctx[0], false, false, false),
    					listen_dev(button1, "click", githubButtonClicked, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div4);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$6.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function githubButtonClicked() {
    	window.location.href = "https://github.com/MayoNeurologyAI/NeuralNetworksNeuropsychology";
    }

    function instance$6($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("Home", slots, []);

    	function studiesButtonClicked() {
    		routingStore.set(RoutingLocation.NPPaperStudies);
    	}

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<Home> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({
    		mapleIcon: img$5,
    		RoutingLocation,
    		routingStore,
    		studiesButtonClicked,
    		githubButtonClicked
    	});

    	return [studiesButtonClicked];
    }

    class Home extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$6, create_fragment$6, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Home",
    			options,
    			id: create_fragment$6.name
    		});
    	}
    }

    // Return a random value between min (included) & max (excluded)
    function mplRandom(min, max) {
        min = +min;
        max = +max;
        max -= min;
        return Math.random() * max + min;
    }

    function mplHtan(x) {
        return Math.tanh(x);
    }

    function mplLogSig(x) {
        return 1 / (1 + Math.exp(-x));
    }

    var Transform;
    (function (Transform) {
        Transform[Transform["htan"] = 0] = "htan";
        Transform[Transform["linear"] = 1] = "linear";
        Transform[Transform["logsig"] = 2] = "logsig";
    })(Transform || (Transform = {}));
    var Transform$1 = Transform;

    function mplTransform(x, t) {
        switch (t) {
            case Transform$1.linear:
                return x;
            case Transform$1.logsig:
                return mplLogSig(x);
            case Transform$1.htan:
                return mplHtan(x);
        }
    }

    function mplDrvHtan(x) {
        return 1 - Math.pow(x, 2);
    }

    // expecting x to be the result of mplLogSig
    function mplDrvLogSig(x) {
        return x * (1 - x);
    }

    function mplDrvTransform(x, t) {
        switch (t) {
            case Transform$1.linear:
                return x;
            case Transform$1.logsig:
                return mplDrvLogSig(x);
            case Transform$1.htan:
                return mplDrvHtan(x);
        }
    }

    class MplLayer {
        constructor(inputs, outputs, transform, useBias = true) {
            this.name = "incognito";
            this.input = [];
            this.error = [];
            this.output = [];
            this.transform = transform;
            this.inputLength = inputs;
            this.outputLength = outputs;
            this.useBias = useBias;
            this.resetLayer();
        }
        resetLayer() {
            this.lastWeightDeltas = undefined;
            this.lastWeightChanges = undefined;
            this.params = {
                bias: [],
                weights: []
            };
            for (let i = 0; i < this.outputLength; i++) {
                if (this.useBias) {
                    this.params.bias.push(0);
                }
                this.params.weights[i] = [];
                for (let j = 0; j < this.inputLength; j++) {
                    this.params.weights[i].push(0);
                }
            }
        }
        forward(inputs) {
            let outputs = [];
            for (let i = 0; i < this.params.weights.length; i++) {
                outputs.push(0);
            }
            for (let i = 0; i < this.params.bias.length; i++) {
                outputs[i] += this.params.bias[i];
            }
            for (let outputIndex = 0; outputIndex < this.params.weights.length; outputIndex++) {
                for (let inputIndex = 0; inputIndex < this.params.weights[outputIndex].length; inputIndex++) {
                    outputs[outputIndex] += this.params.weights[outputIndex][inputIndex] * inputs[inputIndex];
                }
            }
            for (let i = 0; i < this.params.weights.length; i++) {
                outputs[i] = mplTransform(outputs[i], this.transform);
            }
            this.input = inputs;
            this.output = outputs;
            return outputs;
        }
        errorsWithExpectedOuts(expectedOuts, outputs) {
            let errors = [];
            for (let i = 0; i < outputs.length; i++) {
                let d = mplDrvTransform(outputs[i], this.transform);
                let diff = expectedOuts[i] - outputs[i];
                errors.push(diff * d);
            }
            this.error = errors;
            return errors;
        }
        errorsWithRecievingLayer(outputs, recLayer, recErrors) {
            let errors = [];
            for (let i = 0; i < this.params.weights.length; i++) {
                errors.push(0);
            }
            for (let outputIndex = 0; outputIndex < this.params.weights.length; outputIndex++) {
                for (let recIndex = 0; recIndex < recLayer.params.weights.length; recIndex++) {
                    errors[outputIndex] += recErrors[recIndex] * recLayer.params.weights[recIndex][outputIndex];
                }
            }
            for (let i = 0; i < outputs.length; i++) {
                errors[i] = mplDrvTransform(outputs[i], this.transform) * errors[i];
            }
            this.error = errors;
            return errors;
        }
        weightChanges(errors, sendingOutputs, lr = 1, mo = 0) {
            let p = {
                bias: [],
                weights: []
            };
            for (let i = 0; i < this.params.bias.length; i++) {
                if (mo !== 0 && this.lastWeightDeltas !== undefined) {
                    p.bias.push(this.lastWeightDeltas.bias[i] * mo);
                }
                else {
                    p.bias.push(0);
                }
            }
            for (let i = 0; i < this.params.weights.length; i++) {
                p.weights[i] = [];
                for (let j = 0; j < this.params.weights[i].length; j++) {
                    if (mo !== 0 && this.lastWeightDeltas !== undefined) {
                        p.weights[i].push(this.lastWeightDeltas.weights[i][j] * mo);
                    }
                    else {
                        p.weights[i].push(0);
                    }
                }
            }
            for (let bIndex = 0; bIndex < this.params.bias.length; bIndex++) {
                p.bias[bIndex] += errors[bIndex] * lr;
            }
            for (let outputIndex = 0; outputIndex < errors.length; outputIndex++) {
                for (let inputIndex = 0; inputIndex < this.params.weights[outputIndex].length; inputIndex++) {
                    p.weights[outputIndex][inputIndex] += errors[outputIndex] * sendingOutputs[inputIndex] * lr;
                }
            }
            this.lastWeightDeltas = p;
            return p;
        }
        applyWeightChanges(deltas) {
            for (let i = 0; i < this.params.bias.length; i++) {
                this.params.bias[i] += deltas.bias[i];
            }
            for (let i = 0; i < this.params.weights.length; i++) {
                for (let j = 0; j < this.params.weights[i].length; j++)
                    this.params.weights[i][j] += deltas.weights[i][j];
            }
            this.lastWeightChanges = deltas;
        }
        randomizeParams(min, max) {
            for (let i = 0; i < this.params.bias.length; i++) {
                this.params.bias[i] = mplRandom(min, max);
            }
            for (let i = 0; i < this.params.weights.length; i++) {
                for (let j = 0; j < this.params.weights[i].length; j++) {
                    this.params.weights[i][j] = mplRandom(min, max);
                }
            }
        }
    }

    class MplNetwork {
        constructor(name, description = "No description provided.") {
            this.name = name;
            this.description = description;
        }
    }

    class HiddenLayerNetwork extends MplNetwork {
        constructor(inputLayerSize, hiddenLayerSize) {
            super("simple hidden");
            this.inputLayerSize = inputLayerSize;
            this.hiddenLayerSize = hiddenLayerSize;
            this.ol = new MplLayer(hiddenLayerSize, 1, Transform$1.htan);
            this.hl = new MplLayer(inputLayerSize, hiddenLayerSize, Transform$1.htan);
        }
        generateNewNetwork() {
            return new HiddenLayerNetwork(this.inputLayerSize, this.hiddenLayerSize);
        }
        fowardPass(input) {
            let hOut = this.hl.forward(input);
            let oOut = this.ol.forward(hOut);
            return oOut;
        }
        backwardPass(expectedOuts, lr, mo) {
            let outErrors = this.ol.errorsWithExpectedOuts(expectedOuts, this.ol.output);
            this.hl.errorsWithRecievingLayer(this.hl.output, this.ol, outErrors);
            this.ol.weightChanges(this.ol.error, this.hl.output, lr);
            this.hl.weightChanges(this.hl.error, this.hl.input, lr);
        }
        applyWeightChanges() {
            this.ol.applyWeightChanges(this.ol.lastWeightDeltas);
            this.hl.applyWeightChanges(this.hl.lastWeightDeltas);
        }
        randomizeWeights(min, max) {
            this.hl.randomizeParams(min, max);
            this.ol.randomizeParams(min, max);
        }
        resetNetwork() {
            this.hl.resetLayer;
            this.ol.resetLayer;
        }
        stateToString() {
            return `OWs: ${this.ol.params.weights}, OBs: ${this.ol.params.bias}, HWs: ${this.hl.params.weights}, HBs: ${this.hl.params.bias}`;
        }
    }

    // https://stackoverflow.com/a/6274381
    function mplShuffleArray(a) {
        var j, x, i;
        for (i = a.length - 1; i > 0; i--) {
            j = Math.floor(Math.random() * (i + 1));
            x = a[i];
            a[i] = a[j];
            a[j] = x;
        }
        return a;
    }

    class TrainingSet {
        constructor(data, name = "") {
            this.data = data;
            this.name = name;
        }
        randomSet() {
            let ixs = [];
            for (let i = 0; i < this.data.outputs.length; i++) {
                ixs[i] = i;
            }
            ixs = mplShuffleArray(ixs);
            let shuffledData = { inputs: [], outputs: [] };
            for (let i = 0; i < this.data.outputs.length; i++) {
                shuffledData.inputs[i] = this.data.inputs[ixs[i]];
                shuffledData.outputs[i] = this.data.outputs[ixs[i]];
            }
            return shuffledData;
        }
    }

    function xorTrainingSet() {
        const data = {
            inputs: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
            outputs: [-0.9, 0.9, 0.9, -0.9]
        };
        return new TrainingSet(data, "Xor");
    }

    var img$4 = "data:image/png;base64,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";

    const hyperParams$5 = {
        mo: 0.9,
        lr: 0.6,
        randMin: -1,
        randMax: 1,
    };
    const study$5 = {
        epochMax: 1000,
        errMin: 0.5,
        net: new HiddenLayerNetwork(2, 2),
        retrainingMax: 0,
        simulations: 10000,
    };
    const trainingSet$1 = xorTrainingSet();
    const sp$5 = {
        description: "A feedforward network that can solve exclusive-or (XOR), but not consistently.",
        hyperParams: hyperParams$5,
        image: img$4,
        studyParams: study$5,
        title: "Study 1: Introducing feed-forward networks, illustrating inefficiency and inconsistency.",
        trainingSets: [trainingSet$1]
    };

    class McnNetwork extends MplNetwork {
        constructor(bias, inputs, hiddens) {
            super("simple MCN");
            this.bias = bias;
            this.inputs = inputs;
            this.hiddens = hiddens;
            this.ol = new MplLayer(inputs, 1, Transform$1.htan, false);
            this.hl = new MplLayer(inputs, hiddens, Transform$1.htan, bias);
        }
        generateNewNetwork() {
            return new McnNetwork(this.bias, this.inputs, this.hiddens);
        }
        fowardPass(input) {
            let hlOutput = this.hl.forward(input);
            this.ol.params.weights[0] = hlOutput;
            this.hl.input = input;
            return this.ol.forward(input);
        }
        backwardPass(expectedOuts, lr, mo) {
            let outErrors = this.ol.errorsWithExpectedOuts(expectedOuts, this.ol.output);
            let hidErrors = [];
            for (let i = 0; i < this.ol.input.length; i++) {
                hidErrors.push(outErrors[0] * this.ol.input[i]);
            }
            this.hl.error = hidErrors;
            this.hl.weightChanges(this.hl.error, this.ol.input, lr, mo);
        }
        applyWeightChanges() {
            this.hl.applyWeightChanges(this.hl.lastWeightDeltas);
        }
        randomizeWeights(min, max) {
            this.hl.randomizeParams(min, max);
            this.ol.randomizeParams(min, max);
        }
        stateToString() {
            return `HWs: ${this.hl.params.weights}, HBs: ${this.hl.params.bias}`;
        }
    }

    var img$3 = "data:image/png;base64,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3W+vfyhA6OzshFqtHrQRCACgmZTtEZAYjzh/GiYhQg/X1W9i9oC/b0pKCm644QYAwPTp071yrj39zRrYrsnLLskMd328bqloQ02HmZVCg6774p6c0kBERAwR+on2zxzPztbkif3y2jU1NYiOjobVaoVarR60EQiu8zplkkdZx44cts5hSJdbALvZvb1pJk8Y0PfMyMhAcbFzIcNHHnkEOp3OO+168gTgiG0kO7bvYiMgr7q4+1QG7spAPhMi1LkGZU1LDEKoSspKISIihggn39nK9+hsBUyb2i8BQmRkJMxmM+RyOSyDvSe9QICAs053KzJX18BczdWahyO7uRO6vAL3zvYpkyCUy/v9vSQSCd577z3k5+cDANavX49nnnnGa+fa09+rdsdONgLymvhABSZE+QEAbHYHvihkiEC+obzViN21HQAAkVCAC9M4pYGIiBgi9EtnS7trt3tna/IESCNOfNhf9wDBz88PNptt0M9TMz7LY4X+9i3b2TKHsY6t7msSiFRKBM6YdlKvmZaWhnfeeQcrV67E119/DaPRiM7OTlx11VUAgMWLF2Pu3Lne+2CRyxF4ztluZabySphr6tgAyGu6T2X4tbwVDbpOVgr5DE5pICIihggDoHnDd0ccrRAhc887odcaNWqUK0BQqVSDPoXhkJALPc+n+evv2DKHseZvNnksLthTOzgeH3/8MRYuXIg77rgD5513HuRdIxs++OADyOVyLF++3KvnGDhjGkQqJds1Dar5nMpAPh0iHJ7ScEZCICI1MlYKERExRDhZLZt+gs1gdCsLv+ISCGXH/x/tgQMHMHnyZCgUCp8YgQAAkpBgBF8wy63MXFMH7a5ctsxhzFxd43GN/U+bAtXYlBN+zQkTJmD69Ok477zzMGXKFCiVSggEAlx11VUwm72/kFzENQvcCxwONK3fyItPXpMYpMC4SA0AwGp3YH0RtxYl33Kw3YSd1e3OL2MCTmkgIiKGCP3CbjSiddOPHh3vkHnnn9Dr/fnnn3D40PZykX+70iMQafp8PbfAGwEa1633bA83XHPCr2exWPDTTz9h48aN2LFjB4xG46CdW8C0qVClpbqVdezIgfkg1/kg77ksK9L1758PtKBRz6kM5Hs4pYGIiBgiDIDa/70P2O1uZVE3LoRIqRjSFS+NDEfYgovdymx6A+o/WsNWOQI0f7MJnbXu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";

    const hyperParams$4 = {
        mo: 0.9,
        lr: 0.6,
        randMin: -0.1,
        randMax: 0.1,
    };
    const study$4 = {
        epochMax: 1000,
        errMin: 0.5,
        net: new McnNetwork(false, 2, 2),
        retrainingMax: 0,
        simulations: 10000,
    };
    const trainingSet = xorTrainingSet();
    const sp$4 = {
        description: "A Mirrored Cascaded Network (MCN) that can solve XOR consistently and efficiently.",
        hyperParams: hyperParams$4,
        image: img$3,
        studyParams: study$4,
        title: "Study 2: Addressing inefficiency and inconsistency with cascaded networks",
        trainingSets: [trainingSet]
    };

    function orTrainingSet() {
        const data = {
            inputs: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
            outputs: [-0.9, 0.9, 0.9, 0.9]
        };
        return new TrainingSet(data, "Or");
    }

    const hyperParams$3 = {
        mo: 0.9,
        lr: 0.6,
        randMin: -1,
        randMax: 1,
    };
    const study$3 = {
        epochMax: 1000,
        errMin: 0.5,
        net: new HiddenLayerNetwork(2, 2),
        retrainingMax: 0,
        simulations: 10000,
    };
    const trainingSets$3 = [orTrainingSet(), xorTrainingSet()];
    const sp$3 = {
        description: "After learning OR, then XOR, the Feed Forward network loses its knowledge of OR.",
        hyperParams: hyperParams$3,
        image: img$4,
        studyParams: study$3,
        title: "Study 3a: Demonstrating catastrophic interference in a feed foward network.",
        trainingSets: trainingSets$3
    };

    var img$2 = "data:image/png;base64,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+TIGDBhADUIIIYTUg+YgIYQQQghpoxq7PDEhhBBCKEBCCCGEENJmNXbeEkIIIYRQgIQQQgghpM2iDBJC/r+9Ow+PsrzbPv6dLfseErJAWMImiCCyK+5aRUXFDSt1wbq1LlStyvtU61LbUp4HpbUqtmrV1lZUqljEKgXZkX1HhEAIkAWyzEzWmczM9f4xycCYBQoihJyf47iOxnuZued338nBnL0WEZEjp1VsRERERE5R69at48Ybb8TlcqkYIiIih6FJWkVERERERESk3dMQGxERERERERFp9xSQiIiIiIiIiEi7p4BERERERERERNo9BSQiIiIiIiIi0u5pFRsRERGRY3TVVVcRFRXFF198gdPpVEFERETaIK1iIyIiInKMioqKyMjIYNCgQaxdu1YFERERaYM0xEZERETkGPn9fgAsFouKISIi0kYpIBERERE5RgpIRERE2j4FJCIiIiLHKBAIAApIRERE2jIFJCIiItIm2e12ZsyYwVtvvQXAkCFDeO+999ixYwfl5eUsW7aMMWPGNHtuTEwMDz/8MIsXL2bv3r2UlJSwYcMGpk6dSlZWVrPndOnShTfffJOdO3dSVFTE4sWLmTBhAhaLpdUeJNdeey0fffQRu3btYv/+/WzcuJGXXnqJ3NzcFt/n17/+NYsWLSIvL4+tW7fy/vvvc9tttxEZGakbLyIichwZNTU1NTU1NbW21hwOhzHGmLq6OnPllVcaj8djNm/ebObNm2cKCgqMMcb4/X5z/vnnh52Xmppq1q1bZ4wxxul0mk8++cR8+OGHZufOncYYY8rKyszAgQPDzunSpYspKSkxxhizd+9eM3PmTDNr1izjdrvNyy+/bLZt22aMMWbo0KFh502fPt0YY0wgEDCrVq0yn3zySejaampqzCWXXBJ2/MiRI43L5TLGGLN161bz/vvvmzlz5piqqipjjDFLly410dHRuv9qampqamrHp6kIampqampqam2v2e1206i4uNhcddVVoX1Wq9XMmDHDGGPMrFmzws575513jDHGLFiwwCQlJYWdM23aNGOMMRs2bDBWqzW079133zXGGDNnzhwTGRkZ2p6RkWG+/vpr4/V6jTHGDBs2LLRv3Lhxxhhj3G63Oe+880LbbTabeeSRR4zf7zf79+83CQkJoX2LFi0yxhjz2GOPhV1zUlKSmT9/vjHGmAcffFD3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aDLJr7+mlq233hOca0REREREREROGVriRQRwL1/Jvpdf/9ZvR9Nfj93P/6/CERERERERkVOQAhKRBsVvv4u3qKTF/TXbdlA6+98qlIiIiIiIyClIAYlIg4DHy77pb7S4f+9L07WEr4iIiIiIyClKAYnIIco+/QJ/TW2T7f7KKlxLvlKBRERERERETlEKSEQOEairo3LlmibbnYuXYXw+FUhEREREROQUpYBE5Fuqt3zdZFvVuo0qjIiIiIiIyClMAYnIt3j2FjbdVliswoiIiIiIiJzC7CqBSLjaHTvZ/8HHYdvqCvaoMCIiIiIiIqcwC2BUBhERERERERFpzzTERkRERERERETaPQUkIiIiIiIiItLuKSARERERERERkXZPAYmIiIiIiIiItHsKSERERERERESk3VNAIiIiIiIiIiLtngISEREREREREWn3FJCIiIiIiIiISLungERERERERERE2j0FJCIiIiIiIiLS7ikgEREREREREZF2TwGJiIiIiIiIiLR7CkhEREREREREpN1TQCIiIiIiIiIi7Z4CEhERERERERFp9xSQiIiIiIiIiEi7p4BERERERERERNo9G/C0yiAnWlTXHLLuuYOYXj2oWrfhmF4r667bSTp3JHV5u/DX1LS7WnYYM5oO11xBwOPBW1ish0tEREREROQIqAdJO5V27ZX0eW0aOY891OpxOY88QJ/XppF23ZhWj+sx5Tn6vDaNxLOHH9X1RGZlknHLjaRe+YNj/mwdb76OzAnjsScntct7mzRqBBm33Ehsn1560EVERERERI6QApJ2ylNUQsLwIaTfcC3WyMjmH47ICNJvupaE4UNIu/qKFl8rKqcTKT+4iIThQ6jbtfuorqc2bxf5v5pC4fQ3v7PPaPz+Iz7WYrPR+9UXSLn4/JPuXvWcNpkOzdQ/ceQw+rw2DVtcbNj2/R/OIv9XU3B/tUoPuoiIiIiIyBGyqwTtU+Wadfira7DFxhA/aACuZSuaHBM/aCDWqChMIEBs/77Y4uLwV1U1OS5h+FAgGHJ4CouO6nq8JfvZP+Of3+2HNOaID43umUviyGG4lq44qe5TZFYmyReMovabHU32JY4aQcLwIVjs4b/G7uUrcS9fqYdcRERERETkv6AeJO2U8dbjbghFEoYPbvaYxJHDACj7ZA4Wm42EoYOaP27EEACcC5Y0u9+elEhk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";

    const hyperParams$2 = {
        mo: 0.9,
        lr: 0.6,
        randMin: -0.1,
        randMax: 0.1,
    };
    const study$2 = {
        epochMax: 1000,
        errMin: 0.5,
        net: new McnNetwork(true, 2, 2),
        retrainingMax: 0,
        simulations: 10000,
    };
    const trainingSets$2 = [orTrainingSet(), xorTrainingSet()];
    const sp$2 = {
        description: "After learning OR, then XOR, the MCN loses its knowledge of OR.",
        hyperParams: hyperParams$2,
        image: img$2,
        studyParams: study$2,
        title: "Study 3b: Demonstrating catastrophic interference in a MCN network.",
        trainingSets: trainingSets$2
    };

    var img$1 = "data:image/png;base64,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";

    function or1Context() {
        const data = {
            inputs: [[-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1]],
            outputs: [-0.9, 0.9, 0.9, 0.9]
        };
        return new TrainingSet(data, "Or 1Ctx");
    }

    function xor1Context() {
        const data = {
            inputs: [[1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1]],
            outputs: [-0.9, 0.9, 0.9, -0.9]
        };
        return new TrainingSet(data, "Xor 1Ctx");
    }

    const hyperParams$1 = {
        mo: 0.9,
        lr: 0.6,
        randMin: -1,
        randMax: 1,
    };
    const study$1 = {
        epochMax: 1000,
        errMin: 0.5,
        net: new HiddenLayerNetwork(3, 2),
        retrainingMax: 100,
        simulations: 10000,
    };
    const trainingSets$1 = [or1Context(), xor1Context()];
    const sp$1 = {
        description: "Context is used in a feed forward network and retraining is allowed. Most networks are unable to retrain OR information, but are able to with a fair amount of retraining.",
        hyperParams: hyperParams$1,
        image: img$1,
        studyParams: study$1,
        title: "Study 4a: Using context during learninig in a feed forward network.",
        trainingSets: trainingSets$1
    };

    var img = "data:image/png;base64,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";

    const hyperParams = {
        mo: 0.9,
        lr: 0.6,
        randMin: -0.1,
        randMax: 0.1,
    };
    const study = {
        epochMax: 1000,
        errMin: 0.5,
        net: new McnNetwork(true, 3, 3),
        retrainingMax: 100,
        simulations: 10000,
    };
    const trainingSets = [or1Context(), xor1Context()];
    const sp = {
        description: "Context is used in a MCN network and retraining is allowed. The MCN is able to retain OR after learning XOR in most cases, and can retain both problems with a small amount of retraining.",
        hyperParams: hyperParams,
        image: img,
        studyParams: study,
        title: "Study 4b: Using context during learninig in an MCN network.",
        trainingSets: trainingSets
    };

    const studyArr = [
        sp$5,
        sp$4,
        sp$3,
        sp$2,
        sp$1,
        sp
    ];

    function mplRmseError(expected, outputs) {
        let ss = 0.0;
        for (let i = 0; i < expected.length; i++) {
            expected[i];
            ss += Math.pow(expected[i] - outputs[i], 2);
        }
        const meanSquares = ss / expected.length;
        return Math.sqrt(meanSquares);
    }

    function netResult(net, trainingData) {
        let corr = 0;
        let outputs = [];
        for (let i = 0; i < trainingData.inputs.length; i++) {
            let out = net.fowardPass(trainingData.inputs[i]);
            let roundedOut = Math.round(out[0]);
            if (roundedOut - trainingData.outputs[i] <= 0.1) {
                corr += 1;
            }
            outputs.push(out[0]);
        }
        let rmsError = mplRmseError(trainingData.outputs, outputs);
        let percCorr = corr / trainingData.outputs.length;
        return {
            rmsErr: rmsError,
            percCorr: percCorr,
            iterations: 0
        };
    }
    function trainSingleProblem(hyperParams, trainingSet, study) {
        let data = trainingSet.randomSet();
        let dataPresCount = 0;
        // check if any training is needed, if not return the result
        let result = netResult(study.net, data);
        if (result.percCorr === 1.0 && result.rmsErr <= study.errMin) {
            result.iterations = 0;
            return result;
        }
        for (let epochCount = 1; epochCount <= study.epochMax; epochCount++) {
            if (dataPresCount == data.inputs.length - 1) {
                data = trainingSet.randomSet();
                dataPresCount = 0;
            }
            epoch(hyperParams, study.net, data, dataPresCount);
            result = netResult(study.net, data);
            if (epochCount >= study.epochMax ||
                (result.percCorr === 1.0 && result.rmsErr <= study.errMin)) {
                result.iterations = epochCount;
                return result;
            }
            dataPresCount++;
        }
        return result;
    }
    function epoch(hp, net, trainingData, trainingIndex) {
        net.fowardPass(trainingData.inputs[trainingIndex]);
        net.backwardPass([trainingData.outputs[trainingIndex]], hp.lr, hp.mo);
        net.applyWeightChanges();
    }

    function mplStdDev(avg, scores) {
        let ssdiff = 0;
        for (let i = 0; i < scores.length; i++) {
            ssdiff += Math.pow(scores[i] - avg, 2);
        }
        let avgDiff = ssdiff / scores.length;
        return Math.sqrt(avgDiff);
    }

    function singleProblemStudy(hyperParams, trainingSet, study, completeCallback) {
        let simResults = [];
        for (let simCount = 1; simCount <= study.simulations; simCount++) {
            study.net = study.net.generateNewNetwork();
            study.net.randomizeWeights(hyperParams.randMin, hyperParams.randMax);
            simResults.push(trainSingleProblem(hyperParams, trainingSet, study));
        }
        const studyResults = calcStudyResults(simResults, study.epochMax);
        completeCallback(studyResults);
    }
    function calcStudyResults(simResults, epochMax) {
        let sum = 0;
        let numberCorrect = 0;
        let numberIncorrect = 0;
        let correctIterationsArr = [];
        for (let i = 0; i < simResults.length; i++) {
            if (simResults[i].iterations >= epochMax) {
                numberIncorrect++;
            }
            else {
                numberCorrect++;
                sum = sum + simResults[i].iterations;
                correctIterationsArr.push(simResults[i].iterations);
            }
        }
        const averageEpochs = sum / numberCorrect;
        const stdDev = mplStdDev(averageEpochs, correctIterationsArr);
        const percIncorrect = numberIncorrect / simResults.length;
        return {
            averageEpochs: averageEpochs,
            stdDevEpochs: stdDev,
            percIncorrect: percIncorrect
        };
    }

    function mplAvg(arr) {
        if (!arr || arr.length == 0) {
            return 0.0;
        }
        const sum = arr.reduce((n1, n2) => n1 + n2);
        return sum / arr.length;
    }

    function processMultiProblemResults(maxRetrainsAllowed, trainingSets, results) {
        let initialFailCount = 0;
        let failedToRetrainCount = 0;
        let initialLearningEpochs = 0;
        let initialLearningEpochsArray = [];
        let initialLearningEpochsPerProblemArray = [];
        let retryEpochsArray = [];
        let simCount = results.length;
        let retryCountArray = [];
        let failedToRetainInitiallyCount = 0;
        let names = [];
        trainingSets.forEach((ts) => {
            names.push(ts.name);
        });
        trainingSets.forEach(_ => initialLearningEpochsPerProblemArray.push([]));
        results.forEach(r => {
            if (r.failedToLearnInitially) {
                initialFailCount++;
            }
            else {
                let epochs = 0;
                r.initialTraining.forEach((it, index) => {
                    epochs += it.iterations;
                    initialLearningEpochsPerProblemArray[index].push(it.iterations);
                });
                initialLearningEpochs += epochs;
                initialLearningEpochsArray.push(epochs);
            }
            if (!r.failedToLearnInitially && r.failedToRetrain) {
                failedToRetrainCount++;
            }
            if (!r.failedToLearnInitially && !r.failedToRetrain && r.retryCount > 0) {
                failedToRetainInitiallyCount++;
                retryCountArray.push(r.retryCount);
                let iterations = 0;
                r.retries.forEach(problemRetry => {
                    problemRetry.forEach(training => {
                        iterations += training.iterations;
                    });
                });
                retryEpochsArray.push(iterations);
            }
        });
        let avgInitialLearniningEpochs = initialLearningEpochs / initialLearningEpochsArray.length;
        let avgRtryCount = mplAvg(retryCountArray);
        let avgRetrainingEpochs = mplAvg(retryEpochsArray);
        let avgInitForEachProblem = [];
        let stdInitForEachProblem = [];
        initialLearningEpochsPerProblemArray.forEach(epochsArr => {
            const avg = mplAvg(epochsArr);
            avgInitForEachProblem.push(avg);
            const std = mplStdDev(avg, epochsArr);
            stdInitForEachProblem.push(std);
        });
        let totalEpochsArray = [];
        initialLearningEpochsArray.forEach((initialEpochs, index) => {
            let epochs = initialEpochs;
            if (index < retryEpochsArray.length) {
                epochs += retryEpochsArray[index];
            }
            totalEpochsArray.push(epochs);
        });
        const avgTotalEpochs = mplAvg(totalEpochsArray);
        return {
            avgInitialTrainingEpochs: avgInitialLearniningEpochs,
            stdInitialTrainingEpochs: mplStdDev(avgInitialLearniningEpochs, initialLearningEpochsArray),
            avgTotalSuccessfulEpochs: avgTotalEpochs,
            stdTotalSuccessfulEpochs: mplStdDev(avgTotalEpochs, totalEpochsArray),
            avgInitialEpochsForEachProblem: avgInitForEachProblem,
            stdInitialEpochsForEachProblem: stdInitForEachProblem,
            simCount: simCount,
            avgRetryCount: avgRtryCount,
            stdRetryCount: mplStdDev(avgRtryCount, retryCountArray),
            maxRetrainsAllowed: maxRetrainsAllowed,
            failedToLearnInitiallyCount: initialFailCount,
            percFailedToLearnInitially: initialFailCount / simCount,
            problemNames: names,
            failedToRetainInitiallyCount: failedToRetainInitiallyCount,
            failedToRetrainCount: failedToRetrainCount,
            percFailedToRetrain: failedToRetrainCount / (simCount - initialFailCount),
            avgRetrainingEpochs: avgRetrainingEpochs,
            stdRetraningEpochs: mplStdDev(avgRetrainingEpochs, retryEpochsArray)
        };
    }

    function multiProblemStudy(hyperParams, trainingSets, study, finishedCallback) {
        let results = [];
        for (let i = 0; i < study.simulations; i++) {
            results.push(runSimulation(hyperParams, trainingSets, study));
        }
        let processedResults = processMultiProblemResults(study.retrainingMax, trainingSets, results);
        finishedCallback(processedResults);
    }
    function runSimulation(hyperParams, trainingSets, study) {
        let result = {
            initialTraining: [],
            retries: [],
            retryCount: 0,
            failedToLearnInitially: false,
            failedToRetrain: false
        };
        study.net = study.net.generateNewNetwork();
        study.net.randomizeWeights(hyperParams.randMin, hyperParams.randMax);
        // initial pass at problems
        for (let i = 0; i < trainingSets.length; i++) {
            let trainingResult = trainSingleProblem(hyperParams, trainingSets[i], study);
            result.initialTraining.push(trainingResult);
            if (trainingResult.iterations === study.epochMax) {
                result.failedToLearnInitially = true;
                return result;
            }
        }
        // initialize retries
        result.retries = [];
        trainingSets.forEach(element => {
            result.retries.push([]);
        });
        let problemRepCount = 0;
        while (problemRepCount < study.retrainingMax) {
            if (allProblemsLearned(study.errMin, study.net, trainingSets)) {
                result.retryCount = problemRepCount;
                return result;
            }
            for (let i = 0; i < trainingSets.length; i++) {
                problemRepCount++;
                let trainingResult = trainSingleProblem(hyperParams, trainingSets[i], study);
                result.retries[i].push(trainingResult);
                if (allProblemsLearned(study.errMin, study.net, trainingSets)) {
                    result.retryCount = problemRepCount;
                    return result;
                }
            }
        }
        result.retryCount = problemRepCount;
        // if no retraining is allowed, then processMultiProblemResults would incorrectly label all networks as retaining
        // the first problem
        if (study.retrainingMax > 0) {
            result.failedToRetrain = true;
        }
        else {
            result.failedToRetrain = false;
        }
        return result;
    }
    function allProblemsLearned(errMin, net, trainingSets) {
        for (let i = 0; i < trainingSets.length; i++) {
            let result = netResult(net, trainingSets[i].data);
            if (result.percCorr !== 1.0 || result.rmsErr > errMin) {
                return false;
            }
        }
        return true;
    }

    /* src/components/SingleProblemDisplay.svelte generated by Svelte v3.38.3 */

    const file$4 = "src/components/SingleProblemDisplay.svelte";

    function create_fragment$5(ctx) {
    	let div;
    	let t1;
    	let table;
    	let tr0;
    	let th0;
    	let t3;
    	let th1;
    	let t5;
    	let tr1;
    	let td0;
    	let t6_value = /*results*/ ctx[0].averageEpochs.toFixed(2) + "";
    	let t6;
    	let t7;
    	let t8_value = /*results*/ ctx[0].stdDevEpochs.toFixed(2) + "";
    	let t8;
    	let t9;
    	let t10;
    	let td1;
    	let t11_value = /*results*/ ctx[0].percIncorrect.toFixed(2) + "";
    	let t11;

    	const block = {
    		c: function create() {
    			div = element("div");
    			div.textContent = "Results:";
    			t1 = space();
    			table = element("table");
    			tr0 = element("tr");
    			th0 = element("th");
    			th0.textContent = "Avg. Training Steps (std)";
    			t3 = space();
    			th1 = element("th");
    			th1.textContent = "% Incorrect";
    			t5 = space();
    			tr1 = element("tr");
    			td0 = element("td");
    			t6 = text(t6_value);
    			t7 = text(" (");
    			t8 = text(t8_value);
    			t9 = text(")");
    			t10 = space();
    			td1 = element("td");
    			t11 = text(t11_value);
    			attr_dev(div, "class", "table-title svelte-4sxbt6");
    			add_location(div, file$4, 4, 0, 51);
    			attr_dev(th0, "class", "svelte-4sxbt6");
    			add_location(th0, file$4, 7, 8, 116);
    			attr_dev(th1, "class", "svelte-4sxbt6");
    			add_location(th1, file$4, 8, 8, 159);
    			add_location(tr0, file$4, 6, 4, 103);
    			attr_dev(td0, "class", "svelte-4sxbt6");
    			add_location(td0, file$4, 11, 8, 207);
    			attr_dev(td1, "class", "svelte-4sxbt6");
    			add_location(td1, file$4, 16, 8, 347);
    			add_location(tr1, file$4, 10, 4, 194);
    			attr_dev(table, "class", "svelte-4sxbt6");
    			add_location(table, file$4, 5, 0, 91);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			insert_dev(target, t1, anchor);
    			insert_dev(target, table, anchor);
    			append_dev(table, tr0);
    			append_dev(tr0, th0);
    			append_dev(tr0, t3);
    			append_dev(tr0, th1);
    			append_dev(table, t5);
    			append_dev(table, tr1);
    			append_dev(tr1, td0);
    			append_dev(td0, t6);
    			append_dev(td0, t7);
    			append_dev(td0, t8);
    			append_dev(td0, t9);
    			append_dev(tr1, t10);
    			append_dev(tr1, td1);
    			append_dev(td1, t11);
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*results*/ 1 && t6_value !== (t6_value = /*results*/ ctx[0].averageEpochs.toFixed(2) + "")) set_data_dev(t6, t6_value);
    			if (dirty & /*results*/ 1 && t8_value !== (t8_value = /*results*/ ctx[0].stdDevEpochs.toFixed(2) + "")) set_data_dev(t8, t8_value);
    			if (dirty & /*results*/ 1 && t11_value !== (t11_value = /*results*/ ctx[0].percIncorrect.toFixed(2) + "")) set_data_dev(t11, t11_value);
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			if (detaching) detach_dev(t1);
    			if (detaching) detach_dev(table);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$5.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$5($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("SingleProblemDisplay", slots, []);
    	
    	let { results } = $$props;
    	const writable_props = ["results"];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<SingleProblemDisplay> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ("results" in $$props) $$invalidate(0, results = $$props.results);
    	};

    	$$self.$capture_state = () => ({ results });

    	$$self.$inject_state = $$props => {
    		if ("results" in $$props) $$invalidate(0, results = $$props.results);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [results];
    }

    class SingleProblemDisplay extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$5, create_fragment$5, safe_not_equal, { results: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "SingleProblemDisplay",
    			options,
    			id: create_fragment$5.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*results*/ ctx[0] === undefined && !("results" in props)) {
    			console.warn("<SingleProblemDisplay> was created without expected prop 'results'");
    		}
    	}

    	get results() {
    		throw new Error("<SingleProblemDisplay>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set results(value) {
    		throw new Error("<SingleProblemDisplay>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/MultipleProblemDisplay.svelte generated by Svelte v3.38.3 */

    const file$3 = "src/components/MultipleProblemDisplay.svelte";

    function get_each_context$1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[1] = list[i];
    	child_ctx[3] = i;
    	return child_ctx;
    }

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[1] = list[i];
    	child_ctx[3] = i;
    	return child_ctx;
    }

    // (29:0) {:else}
    function create_else_block$1(ctx) {
    	let div0;
    	let t1;
    	let table0;
    	let tr0;
    	let th0;
    	let t3;
    	let th1;
    	let t5;
    	let th2;
    	let t7;
    	let tr1;
    	let td0;
    	let t8_value = (1 - /*results*/ ctx[0].percFailedToLearnInitially).toFixed(4) + "";
    	let t8;
    	let t9;
    	let td1;
    	let t10_value = /*results*/ ctx[0].avgInitialTrainingEpochs.toFixed(2) + "";
    	let t10;
    	let t11;
    	let t12_value = /*results*/ ctx[0].stdInitialTrainingEpochs.toFixed(2) + "";
    	let t12;
    	let t13;
    	let t14;
    	let td2;
    	let t15_value = (/*results*/ ctx[0].failedToRetainInitiallyCount / /*results*/ ctx[0].simCount).toFixed(4) + "";
    	let t15;
    	let t16;
    	let div1;
    	let t18;
    	let table1;
    	let tr2;
    	let th3;
    	let t20;
    	let th4;
    	let t22;
    	let th5;
    	let t24;
    	let tr3;
    	let td3;
    	let t25_value = (1 - /*results*/ ctx[0].percFailedToRetrain).toFixed(4) + "";
    	let t25;
    	let t26;
    	let td4;
    	let t27_value = /*results*/ ctx[0].avgRetryCount.toFixed(2) + "";
    	let t27;
    	let t28;
    	let t29_value = /*results*/ ctx[0].stdRetryCount.toFixed(2) + "";
    	let t29;
    	let t30;
    	let t31;
    	let td5;
    	let t32_value = /*results*/ ctx[0].avgRetrainingEpochs.toFixed(2) + "";
    	let t32;
    	let t33;
    	let t34_value = /*results*/ ctx[0].stdRetraningEpochs.toFixed(2) + "";
    	let t34;
    	let t35;

    	const block = {
    		c: function create() {
    			div0 = element("div");
    			div0.textContent = "Initial learning:";
    			t1 = space();
    			table0 = element("table");
    			tr0 = element("tr");
    			th0 = element("th");
    			th0.textContent = "Percent learning both problems:";
    			t3 = space();
    			th1 = element("th");
    			th1.textContent = "Avg total training steps (std):";
    			t5 = space();
    			th2 = element("th");
    			th2.textContent = "Percent failed to retain OR:";
    			t7 = space();
    			tr1 = element("tr");
    			td0 = element("td");
    			t8 = text(t8_value);
    			t9 = space();
    			td1 = element("td");
    			t10 = text(t10_value);
    			t11 = text("\n                (");
    			t12 = text(t12_value);
    			t13 = text(")");
    			t14 = space();
    			td2 = element("td");
    			t15 = text(t15_value);
    			t16 = space();
    			div1 = element("div");
    			div1.textContent = "Retraining (of models that could learn both problems but did not retain\n        the first):";
    			t18 = space();
    			table1 = element("table");
    			tr2 = element("tr");
    			th3 = element("th");
    			th3.textContent = "Percent able to learn both problems with retraining";
    			t20 = space();
    			th4 = element("th");
    			th4.textContent = "Avg problem representations to successfully learn both problems\n                (std)";
    			t22 = space();
    			th5 = element("th");
    			th5.textContent = "Avg total additional training steps needed for successful\n                retraining (std):";
    			t24 = space();
    			tr3 = element("tr");
    			td3 = element("td");
    			t25 = text(t25_value);
    			t26 = space();
    			td4 = element("td");
    			t27 = text(t27_value);
    			t28 = text("\n                (");
    			t29 = text(t29_value);
    			t30 = text(")");
    			t31 = space();
    			td5 = element("td");
    			t32 = text(t32_value);
    			t33 = text("\n                (");
    			t34 = text(t34_value);
    			t35 = text(")");
    			attr_dev(div0, "class", "table-title svelte-4sxbt6");
    			add_location(div0, file$3, 29, 4, 935);
    			attr_dev(th0, "class", "svelte-4sxbt6");
    			add_location(th0, file$3, 32, 12, 1021);
    			attr_dev(th1, "class", "svelte-4sxbt6");
    			add_location(th1, file$3, 33, 12, 1074);
    			attr_dev(th2, "class", "svelte-4sxbt6");
    			add_location(th2, file$3, 34, 12, 1127);
    			add_location(tr0, file$3, 31, 8, 1004);
    			attr_dev(td0, "class", "svelte-4sxbt6");
    			add_location(td0, file$3, 37, 12, 1204);
    			attr_dev(td1, "class", "svelte-4sxbt6");
    			add_location(td1, file$3, 38, 12, 1279);
    			attr_dev(td2, "class", "svelte-4sxbt6");
    			add_location(td2, file$3, 42, 12, 1440);
    			add_location(tr1, file$3, 36, 8, 1187);
    			attr_dev(table0, "class", "svelte-4sxbt6");
    			add_location(table0, file$3, 30, 4, 988);
    			attr_dev(div1, "class", "table-title svelte-4sxbt6");
    			add_location(div1, file$3, 49, 4, 1619);
    			attr_dev(th3, "class", "svelte-4sxbt6");
    			add_location(th3, file$3, 55, 12, 1793);
    			attr_dev(th4, "class", "svelte-4sxbt6");
    			add_location(th4, file$3, 56, 12, 1866);
    			attr_dev(th5, "class", "svelte-4sxbt6");
    			add_location(th5, file$3, 60, 12, 2003);
    			add_location(tr2, file$3, 54, 8, 1776);
    			attr_dev(td3, "class", "svelte-4sxbt6");
    			add_location(td3, file$3, 66, 12, 2173);
    			attr_dev(td4, "class", "svelte-4sxbt6");
    			add_location(td4, file$3, 67, 12, 2241);
    			attr_dev(td5, "class", "svelte-4sxbt6");
    			add_location(td5, file$3, 71, 12, 2380);
    			add_location(tr3, file$3, 65, 8, 2156);
    			attr_dev(table1, "class", "svelte-4sxbt6");
    			add_location(table1, file$3, 53, 4, 1760);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div0, anchor);
    			insert_dev(target, t1, anchor);
    			insert_dev(target, table0, anchor);
    			append_dev(table0, tr0);
    			append_dev(tr0, th0);
    			append_dev(tr0, t3);
    			append_dev(tr0, th1);
    			append_dev(tr0, t5);
    			append_dev(tr0, th2);
    			append_dev(table0, t7);
    			append_dev(table0, tr1);
    			append_dev(tr1, td0);
    			append_dev(td0, t8);
    			append_dev(tr1, t9);
    			append_dev(tr1, td1);
    			append_dev(td1, t10);
    			append_dev(td1, t11);
    			append_dev(td1, t12);
    			append_dev(td1, t13);
    			append_dev(tr1, t14);
    			append_dev(tr1, td2);
    			append_dev(td2, t15);
    			insert_dev(target, t16, anchor);
    			insert_dev(target, div1, anchor);
    			insert_dev(target, t18, anchor);
    			insert_dev(target, table1, anchor);
    			append_dev(table1, tr2);
    			append_dev(tr2, th3);
    			append_dev(tr2, t20);
    			append_dev(tr2, th4);
    			append_dev(tr2, t22);
    			append_dev(tr2, th5);
    			append_dev(table1, t24);
    			append_dev(table1, tr3);
    			append_dev(tr3, td3);
    			append_dev(td3, t25);
    			append_dev(tr3, t26);
    			append_dev(tr3, td4);
    			append_dev(td4, t27);
    			append_dev(td4, t28);
    			append_dev(td4, t29);
    			append_dev(td4, t30);
    			append_dev(tr3, t31);
    			append_dev(tr3, td5);
    			append_dev(td5, t32);
    			append_dev(td5, t33);
    			append_dev(td5, t34);
    			append_dev(td5, t35);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*results*/ 1 && t8_value !== (t8_value = (1 - /*results*/ ctx[0].percFailedToLearnInitially).toFixed(4) + "")) set_data_dev(t8, t8_value);
    			if (dirty & /*results*/ 1 && t10_value !== (t10_value = /*results*/ ctx[0].avgInitialTrainingEpochs.toFixed(2) + "")) set_data_dev(t10, t10_value);
    			if (dirty & /*results*/ 1 && t12_value !== (t12_value = /*results*/ ctx[0].stdInitialTrainingEpochs.toFixed(2) + "")) set_data_dev(t12, t12_value);
    			if (dirty & /*results*/ 1 && t15_value !== (t15_value = (/*results*/ ctx[0].failedToRetainInitiallyCount / /*results*/ ctx[0].simCount).toFixed(4) + "")) set_data_dev(t15, t15_value);
    			if (dirty & /*results*/ 1 && t25_value !== (t25_value = (1 - /*results*/ ctx[0].percFailedToRetrain).toFixed(4) + "")) set_data_dev(t25, t25_value);
    			if (dirty & /*results*/ 1 && t27_value !== (t27_value = /*results*/ ctx[0].avgRetryCount.toFixed(2) + "")) set_data_dev(t27, t27_value);
    			if (dirty & /*results*/ 1 && t29_value !== (t29_value = /*results*/ ctx[0].stdRetryCount.toFixed(2) + "")) set_data_dev(t29, t29_value);
    			if (dirty & /*results*/ 1 && t32_value !== (t32_value = /*results*/ ctx[0].avgRetrainingEpochs.toFixed(2) + "")) set_data_dev(t32, t32_value);
    			if (dirty & /*results*/ 1 && t34_value !== (t34_value = /*results*/ ctx[0].stdRetraningEpochs.toFixed(2) + "")) set_data_dev(t34, t34_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div0);
    			if (detaching) detach_dev(t1);
    			if (detaching) detach_dev(table0);
    			if (detaching) detach_dev(t16);
    			if (detaching) detach_dev(div1);
    			if (detaching) detach_dev(t18);
    			if (detaching) detach_dev(table1);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block$1.name,
    		type: "else",
    		source: "(29:0) {:else}",
    		ctx
    	});

    	return block;
    }

    // (5:0) {#if results.maxRetrainsAllowed === 0}
    function create_if_block$3(ctx) {
    	let div;
    	let t1;
    	let table;
    	let tr;
    	let t2;
    	let th0;
    	let t4;
    	let th1;
    	let t5;
    	let t6_value = /*results*/ ctx[0].problemNames[0] + "";
    	let t6;
    	let t7;
    	let t8;
    	let td0;
    	let t9_value = (1 - /*results*/ ctx[0].percFailedToLearnInitially).toFixed(4) + "";
    	let t9;
    	let t10;
    	let td1;
    	let t11_value = (/*results*/ ctx[0].failedToRetainInitiallyCount / /*results*/ ctx[0].simCount).toFixed(2) + "";
    	let t11;
    	let each_value_1 = /*results*/ ctx[0].problemNames;
    	validate_each_argument(each_value_1);
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks_1[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
    	}

    	let each_value = /*results*/ ctx[0].problemNames;
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$1(get_each_context$1(ctx, each_value, i));
    	}

    	const block = {
    		c: function create() {
    			div = element("div");
    			div.textContent = "Results:";
    			t1 = space();
    			table = element("table");
    			tr = element("tr");

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].c();
    			}

    			t2 = space();
    			th0 = element("th");
    			th0.textContent = "Percent learning all problems:";
    			t4 = space();
    			th1 = element("th");
    			t5 = text("Percent retaining ");
    			t6 = text(t6_value);
    			t7 = space();

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t8 = space();
    			td0 = element("td");
    			t9 = text(t9_value);
    			t10 = space();
    			td1 = element("td");
    			t11 = text(t11_value);
    			attr_dev(div, "class", "table-title svelte-4sxbt6");
    			add_location(div, file$3, 5, 4, 94);
    			attr_dev(th0, "class", "svelte-4sxbt6");
    			add_location(th0, file$3, 11, 12, 324);
    			attr_dev(th1, "class", "svelte-4sxbt6");
    			add_location(th1, file$3, 12, 12, 376);
    			add_location(tr, file$3, 7, 8, 154);
    			attr_dev(td0, "class", "svelte-4sxbt6");
    			add_location(td0, file$3, 21, 8, 707);
    			attr_dev(td1, "class", "svelte-4sxbt6");
    			add_location(td1, file$3, 22, 8, 778);
    			attr_dev(table, "class", "svelte-4sxbt6");
    			add_location(table, file$3, 6, 4, 138);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			insert_dev(target, t1, anchor);
    			insert_dev(target, table, anchor);
    			append_dev(table, tr);

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].m(tr, null);
    			}

    			append_dev(tr, t2);
    			append_dev(tr, th0);
    			append_dev(tr, t4);
    			append_dev(tr, th1);
    			append_dev(th1, t5);
    			append_dev(th1, t6);
    			append_dev(table, t7);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(table, null);
    			}

    			append_dev(table, t8);
    			append_dev(table, td0);
    			append_dev(td0, t9);
    			append_dev(table, t10);
    			append_dev(table, td1);
    			append_dev(td1, t11);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*results*/ 1) {
    				each_value_1 = /*results*/ ctx[0].problemNames;
    				validate_each_argument(each_value_1);
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1(ctx, each_value_1, i);

    					if (each_blocks_1[i]) {
    						each_blocks_1[i].p(child_ctx, dirty);
    					} else {
    						each_blocks_1[i] = create_each_block_1(child_ctx);
    						each_blocks_1[i].c();
    						each_blocks_1[i].m(tr, t2);
    					}
    				}

    				for (; i < each_blocks_1.length; i += 1) {
    					each_blocks_1[i].d(1);
    				}

    				each_blocks_1.length = each_value_1.length;
    			}

    			if (dirty & /*results*/ 1 && t6_value !== (t6_value = /*results*/ ctx[0].problemNames[0] + "")) set_data_dev(t6, t6_value);

    			if (dirty & /*results*/ 1) {
    				each_value = /*results*/ ctx[0].problemNames;
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$1(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block$1(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(table, t8);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (dirty & /*results*/ 1 && t9_value !== (t9_value = (1 - /*results*/ ctx[0].percFailedToLearnInitially).toFixed(4) + "")) set_data_dev(t9, t9_value);
    			if (dirty & /*results*/ 1 && t11_value !== (t11_value = (/*results*/ ctx[0].failedToRetainInitiallyCount / /*results*/ ctx[0].simCount).toFixed(2) + "")) set_data_dev(t11, t11_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			if (detaching) detach_dev(t1);
    			if (detaching) detach_dev(table);
    			destroy_each(each_blocks_1, detaching);
    			destroy_each(each_blocks, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$3.name,
    		type: "if",
    		source: "(5:0) {#if results.maxRetrainsAllowed === 0}",
    		ctx
    	});

    	return block;
    }

    // (9:12) {#each results.problemNames as name, index}
    function create_each_block_1(ctx) {
    	let th;
    	let t0;
    	let t1_value = /*name*/ ctx[1] + "";
    	let t1;
    	let t2;

    	const block = {
    		c: function create() {
    			th = element("th");
    			t0 = text("Avg Training Steps to initially learn ");
    			t1 = text(t1_value);
    			t2 = text(" (std):");
    			attr_dev(th, "class", "svelte-4sxbt6");
    			add_location(th, file$3, 9, 16, 231);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, th, anchor);
    			append_dev(th, t0);
    			append_dev(th, t1);
    			append_dev(th, t2);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*results*/ 1 && t1_value !== (t1_value = /*name*/ ctx[1] + "")) set_data_dev(t1, t1_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(th);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block_1.name,
    		type: "each",
    		source: "(9:12) {#each results.problemNames as name, index}",
    		ctx
    	});

    	return block;
    }

    // (16:8) {#each results.problemNames as name, index}
    function create_each_block$1(ctx) {
    	let td;
    	let t0_value = /*results*/ ctx[0].avgInitialEpochsForEachProblem[/*index*/ ctx[3]].toFixed(2) + "";
    	let t0;
    	let t1;
    	let t2_value = /*results*/ ctx[0].stdInitialEpochsForEachProblem[/*index*/ ctx[3]].toFixed(2) + "";
    	let t2;
    	let t3;

    	const block = {
    		c: function create() {
    			td = element("td");
    			t0 = text(t0_value);
    			t1 = text("\n                (");
    			t2 = text(t2_value);
    			t3 = text(")");
    			attr_dev(td, "class", "svelte-4sxbt6");
    			add_location(td, file$3, 16, 12, 508);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, td, anchor);
    			append_dev(td, t0);
    			append_dev(td, t1);
    			append_dev(td, t2);
    			append_dev(td, t3);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*results*/ 1 && t0_value !== (t0_value = /*results*/ ctx[0].avgInitialEpochsForEachProblem[/*index*/ ctx[3]].toFixed(2) + "")) set_data_dev(t0, t0_value);
    			if (dirty & /*results*/ 1 && t2_value !== (t2_value = /*results*/ ctx[0].stdInitialEpochsForEachProblem[/*index*/ ctx[3]].toFixed(2) + "")) set_data_dev(t2, t2_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(td);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block$1.name,
    		type: "each",
    		source: "(16:8) {#each results.problemNames as name, index}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$4(ctx) {
    	let if_block_anchor;

    	function select_block_type(ctx, dirty) {
    		if (/*results*/ ctx[0].maxRetrainsAllowed === 0) return create_if_block$3;
    		return create_else_block$1;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block = current_block_type(ctx);

    	const block = {
    		c: function create() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			if_block.m(target, anchor);
    			insert_dev(target, if_block_anchor, anchor);
    		},
    		p: function update(ctx, [dirty]) {
    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if_block.d(detaching);
    			if (detaching) detach_dev(if_block_anchor);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$4.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$4($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("MultipleProblemDisplay", slots, []);
    	
    	let { results } = $$props;
    	const writable_props = ["results"];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<MultipleProblemDisplay> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ("results" in $$props) $$invalidate(0, results = $$props.results);
    	};

    	$$self.$capture_state = () => ({ results });

    	$$self.$inject_state = $$props => {
    		if ("results" in $$props) $$invalidate(0, results = $$props.results);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [results];
    }

    class MultipleProblemDisplay extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$4, create_fragment$4, safe_not_equal, { results: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "MultipleProblemDisplay",
    			options,
    			id: create_fragment$4.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*results*/ ctx[0] === undefined && !("results" in props)) {
    			console.warn("<MultipleProblemDisplay> was created without expected prop 'results'");
    		}
    	}

    	get results() {
    		throw new Error("<MultipleProblemDisplay>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set results(value) {
    		throw new Error("<MultipleProblemDisplay>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/ParameterDisplay.svelte generated by Svelte v3.38.3 */
    const file$2 = "src/components/ParameterDisplay.svelte";

    // (43:4) {#if isMultiProblem}
    function create_if_block$2(ctx) {
    	let tr;
    	let th;
    	let t1;
    	let td;
    	let input;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			tr = element("tr");
    			th = element("th");
    			th.textContent = "Max learning retries:";
    			t1 = space();
    			td = element("td");
    			input = element("input");
    			attr_dev(th, "class", "svelte-bwugkg");
    			add_location(th, file$2, 44, 12, 1218);
    			attr_dev(input, "type", "number");
    			attr_dev(input, "class", "svelte-bwugkg");
    			add_location(input, file$2, 45, 16, 1265);
    			attr_dev(td, "class", "svelte-bwugkg");
    			add_location(td, file$2, 45, 12, 1261);
    			add_location(tr, file$2, 43, 8, 1201);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, tr, anchor);
    			append_dev(tr, th);
    			append_dev(tr, t1);
    			append_dev(tr, td);
    			append_dev(td, input);
    			set_input_value(input, /*learningRetries*/ ctx[7]);

    			if (!mounted) {
    				dispose = listen_dev(input, "input", /*input_input_handler*/ ctx[16]);
    				mounted = true;
    			}
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*learningRetries*/ 128 && to_number(input.value) !== /*learningRetries*/ ctx[7]) {
    				set_input_value(input, /*learningRetries*/ ctx[7]);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(tr);
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$2.name,
    		type: "if",
    		source: "(43:4) {#if isMultiProblem}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$3(ctx) {
    	let div;
    	let t1;
    	let table;
    	let tr0;
    	let th0;
    	let t3;
    	let td0;
    	let input0;
    	let t4;
    	let tr1;
    	let th1;
    	let t6;
    	let td1;
    	let input1;
    	let t7;
    	let tr2;
    	let th2;
    	let t9;
    	let td2;
    	let input2;
    	let t10;
    	let tr3;
    	let th3;
    	let t12;
    	let td3;
    	let input3;
    	let t13;
    	let tr4;
    	let th4;
    	let t15;
    	let td4;
    	let input4;
    	let t16;
    	let tr5;
    	let th5;
    	let t18;
    	let td5;
    	let input5;
    	let t19;
    	let tr6;
    	let th6;
    	let t21;
    	let td6;
    	let input6;
    	let t22;
    	let mounted;
    	let dispose;
    	let if_block = /*isMultiProblem*/ ctx[8] && create_if_block$2(ctx);

    	const block = {
    		c: function create() {
    			div = element("div");
    			div.textContent = "Study Parameters";
    			t1 = space();
    			table = element("table");
    			tr0 = element("tr");
    			th0 = element("th");
    			th0.textContent = "Number of simulations:";
    			t3 = space();
    			td0 = element("td");
    			input0 = element("input");
    			t4 = space();
    			tr1 = element("tr");
    			th1 = element("th");
    			th1.textContent = "Max number of training steps per simulation:";
    			t6 = space();
    			td1 = element("td");
    			input1 = element("input");
    			t7 = space();
    			tr2 = element("tr");
    			th2 = element("th");
    			th2.textContent = "Minimum error value:";
    			t9 = space();
    			td2 = element("td");
    			input2 = element("input");
    			t10 = space();
    			tr3 = element("tr");
    			th3 = element("th");
    			th3.textContent = "Weight initialization minimum:";
    			t12 = space();
    			td3 = element("td");
    			input3 = element("input");
    			t13 = space();
    			tr4 = element("tr");
    			th4 = element("th");
    			th4.textContent = "Weight initialization maximum:";
    			t15 = space();
    			td4 = element("td");
    			input4 = element("input");
    			t16 = space();
    			tr5 = element("tr");
    			th5 = element("th");
    			th5.textContent = "Learning rate:";
    			t18 = space();
    			td5 = element("td");
    			input5 = element("input");
    			t19 = space();
    			tr6 = element("tr");
    			th6 = element("th");
    			th6.textContent = "Momentum:";
    			t21 = space();
    			td6 = element("td");
    			input6 = element("input");
    			t22 = space();
    			if (if_block) if_block.c();
    			attr_dev(div, "class", "table-title svelte-bwugkg");
    			add_location(div, file$2, 12, 0, 257);
    			attr_dev(th0, "class", "svelte-bwugkg");
    			add_location(th0, file$2, 15, 8, 330);
    			attr_dev(input0, "type", "number");
    			attr_dev(input0, "class", "svelte-bwugkg");
    			add_location(input0, file$2, 16, 12, 374);
    			attr_dev(td0, "class", "svelte-bwugkg");
    			add_location(td0, file$2, 16, 8, 370);
    			add_location(tr0, file$2, 14, 4, 317);
    			attr_dev(th1, "class", "svelte-bwugkg");
    			add_location(th1, file$2, 19, 8, 452);
    			attr_dev(input1, "type", "number");
    			attr_dev(input1, "class", "svelte-bwugkg");
    			add_location(input1, file$2, 20, 12, 518);
    			attr_dev(td1, "class", "svelte-bwugkg");
    			add_location(td1, file$2, 20, 8, 514);
    			add_location(tr1, file$2, 18, 4, 439);
    			attr_dev(th2, "class", "svelte-bwugkg");
    			add_location(th2, file$2, 23, 8, 596);
    			attr_dev(input2, "type", "number");
    			attr_dev(input2, "class", "svelte-bwugkg");
    			add_location(input2, file$2, 24, 12, 638);
    			attr_dev(td2, "class", "svelte-bwugkg");
    			add_location(td2, file$2, 24, 8, 634);
    			add_location(tr2, file$2, 22, 4, 583);
    			attr_dev(th3, "class", "svelte-bwugkg");
    			add_location(th3, file$2, 27, 8, 716);
    			attr_dev(input3, "type", "number");
    			attr_dev(input3, "class", "svelte-bwugkg");
    			add_location(input3, file$2, 28, 12, 768);
    			attr_dev(td3, "class", "svelte-bwugkg");
    			add_location(td3, file$2, 28, 8, 764);
    			add_location(tr3, file$2, 26, 4, 703);
    			attr_dev(th4, "class", "svelte-bwugkg");
    			add_location(th4, file$2, 31, 8, 845);
    			attr_dev(input4, "type", "number");
    			attr_dev(input4, "class", "svelte-bwugkg");
    			add_location(input4, file$2, 32, 12, 897);
    			attr_dev(td4, "class", "svelte-bwugkg");
    			add_location(td4, file$2, 32, 8, 893);
    			add_location(tr4, file$2, 30, 4, 832);
    			attr_dev(th5, "class", "svelte-bwugkg");
    			add_location(th5, file$2, 35, 8, 974);
    			attr_dev(input5, "type", "number");
    			attr_dev(input5, "class", "svelte-bwugkg");
    			add_location(input5, file$2, 36, 12, 1010);
    			attr_dev(td5, "class", "svelte-bwugkg");
    			add_location(td5, file$2, 36, 8, 1006);
    			add_location(tr5, file$2, 34, 4, 961);
    			attr_dev(th6, "class", "svelte-bwugkg");
    			add_location(th6, file$2, 39, 8, 1082);
    			attr_dev(input6, "type", "number");
    			attr_dev(input6, "class", "svelte-bwugkg");
    			add_location(input6, file$2, 40, 12, 1113);
    			attr_dev(td6, "class", "svelte-bwugkg");
    			add_location(td6, file$2, 40, 8, 1109);
    			add_location(tr6, file$2, 38, 4, 1069);
    			attr_dev(table, "class", "svelte-bwugkg");
    			add_location(table, file$2, 13, 0, 305);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			insert_dev(target, t1, anchor);
    			insert_dev(target, table, anchor);
    			append_dev(table, tr0);
    			append_dev(tr0, th0);
    			append_dev(tr0, t3);
    			append_dev(tr0, td0);
    			append_dev(td0, input0);
    			set_input_value(input0, /*simCount*/ ctx[6]);
    			append_dev(table, t4);
    			append_dev(table, tr1);
    			append_dev(tr1, th1);
    			append_dev(tr1, t6);
    			append_dev(tr1, td1);
    			append_dev(td1, input1);
    			set_input_value(input1, /*epochMax*/ ctx[0]);
    			append_dev(table, t7);
    			append_dev(table, tr2);
    			append_dev(tr2, th2);
    			append_dev(tr2, t9);
    			append_dev(tr2, td2);
    			append_dev(td2, input2);
    			set_input_value(input2, /*errorMin*/ ctx[1]);
    			append_dev(table, t10);
    			append_dev(table, tr3);
    			append_dev(tr3, th3);
    			append_dev(tr3, t12);
    			append_dev(tr3, td3);
    			append_dev(td3, input3);
    			set_input_value(input3, /*initMin*/ ctx[2]);
    			append_dev(table, t13);
    			append_dev(table, tr4);
    			append_dev(tr4, th4);
    			append_dev(tr4, t15);
    			append_dev(tr4, td4);
    			append_dev(td4, input4);
    			set_input_value(input4, /*initMax*/ ctx[3]);
    			append_dev(table, t16);
    			append_dev(table, tr5);
    			append_dev(tr5, th5);
    			append_dev(tr5, t18);
    			append_dev(tr5, td5);
    			append_dev(td5, input5);
    			set_input_value(input5, /*lr*/ ctx[4]);
    			append_dev(table, t19);
    			append_dev(table, tr6);
    			append_dev(tr6, th6);
    			append_dev(tr6, t21);
    			append_dev(tr6, td6);
    			append_dev(td6, input6);
    			set_input_value(input6, /*mo*/ ctx[5]);
    			append_dev(table, t22);
    			if (if_block) if_block.m(table, null);

    			if (!mounted) {
    				dispose = [
    					listen_dev(input0, "input", /*input0_input_handler*/ ctx[9]),
    					listen_dev(input1, "input", /*input1_input_handler*/ ctx[10]),
    					listen_dev(input2, "input", /*input2_input_handler*/ ctx[11]),
    					listen_dev(input3, "input", /*input3_input_handler*/ ctx[12]),
    					listen_dev(input4, "input", /*input4_input_handler*/ ctx[13]),
    					listen_dev(input5, "input", /*input5_input_handler*/ ctx[14]),
    					listen_dev(input6, "input", /*input6_input_handler*/ ctx[15])
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*simCount*/ 64 && to_number(input0.value) !== /*simCount*/ ctx[6]) {
    				set_input_value(input0, /*simCount*/ ctx[6]);
    			}

    			if (dirty & /*epochMax*/ 1 && to_number(input1.value) !== /*epochMax*/ ctx[0]) {
    				set_input_value(input1, /*epochMax*/ ctx[0]);
    			}

    			if (dirty & /*errorMin*/ 2 && to_number(input2.value) !== /*errorMin*/ ctx[1]) {
    				set_input_value(input2, /*errorMin*/ ctx[1]);
    			}

    			if (dirty & /*initMin*/ 4 && to_number(input3.value) !== /*initMin*/ ctx[2]) {
    				set_input_value(input3, /*initMin*/ ctx[2]);
    			}

    			if (dirty & /*initMax*/ 8 && to_number(input4.value) !== /*initMax*/ ctx[3]) {
    				set_input_value(input4, /*initMax*/ ctx[3]);
    			}

    			if (dirty & /*lr*/ 16 && to_number(input5.value) !== /*lr*/ ctx[4]) {
    				set_input_value(input5, /*lr*/ ctx[4]);
    			}

    			if (dirty & /*mo*/ 32 && to_number(input6.value) !== /*mo*/ ctx[5]) {
    				set_input_value(input6, /*mo*/ ctx[5]);
    			}

    			if (/*isMultiProblem*/ ctx[8]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block$2(ctx);
    					if_block.c();
    					if_block.m(table, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			if (detaching) detach_dev(t1);
    			if (detaching) detach_dev(table);
    			if (if_block) if_block.d();
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$3.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$3($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("ParameterDisplay", slots, []);
    	let { epochMax } = $$props;
    	let { errorMin } = $$props;
    	let { initMin } = $$props;
    	let { initMax } = $$props;
    	let { lr } = $$props;
    	let { mo } = $$props;
    	let { simCount } = $$props;
    	let { learningRetries } = $$props;
    	let { isMultiProblem } = $$props;

    	const writable_props = [
    		"epochMax",
    		"errorMin",
    		"initMin",
    		"initMax",
    		"lr",
    		"mo",
    		"simCount",
    		"learningRetries",
    		"isMultiProblem"
    	];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<ParameterDisplay> was created with unknown prop '${key}'`);
    	});

    	function input0_input_handler() {
    		simCount = to_number(this.value);
    		$$invalidate(6, simCount);
    	}

    	function input1_input_handler() {
    		epochMax = to_number(this.value);
    		$$invalidate(0, epochMax);
    	}

    	function input2_input_handler() {
    		errorMin = to_number(this.value);
    		$$invalidate(1, errorMin);
    	}

    	function input3_input_handler() {
    		initMin = to_number(this.value);
    		$$invalidate(2, initMin);
    	}

    	function input4_input_handler() {
    		initMax = to_number(this.value);
    		$$invalidate(3, initMax);
    	}

    	function input5_input_handler() {
    		lr = to_number(this.value);
    		$$invalidate(4, lr);
    	}

    	function input6_input_handler() {
    		mo = to_number(this.value);
    		$$invalidate(5, mo);
    	}

    	function input_input_handler() {
    		learningRetries = to_number(this.value);
    		$$invalidate(7, learningRetries);
    	}

    	$$self.$$set = $$props => {
    		if ("epochMax" in $$props) $$invalidate(0, epochMax = $$props.epochMax);
    		if ("errorMin" in $$props) $$invalidate(1, errorMin = $$props.errorMin);
    		if ("initMin" in $$props) $$invalidate(2, initMin = $$props.initMin);
    		if ("initMax" in $$props) $$invalidate(3, initMax = $$props.initMax);
    		if ("lr" in $$props) $$invalidate(4, lr = $$props.lr);
    		if ("mo" in $$props) $$invalidate(5, mo = $$props.mo);
    		if ("simCount" in $$props) $$invalidate(6, simCount = $$props.simCount);
    		if ("learningRetries" in $$props) $$invalidate(7, learningRetries = $$props.learningRetries);
    		if ("isMultiProblem" in $$props) $$invalidate(8, isMultiProblem = $$props.isMultiProblem);
    	};

    	$$self.$capture_state = () => ({
    		text,
    		epochMax,
    		errorMin,
    		initMin,
    		initMax,
    		lr,
    		mo,
    		simCount,
    		learningRetries,
    		isMultiProblem
    	});

    	$$self.$inject_state = $$props => {
    		if ("epochMax" in $$props) $$invalidate(0, epochMax = $$props.epochMax);
    		if ("errorMin" in $$props) $$invalidate(1, errorMin = $$props.errorMin);
    		if ("initMin" in $$props) $$invalidate(2, initMin = $$props.initMin);
    		if ("initMax" in $$props) $$invalidate(3, initMax = $$props.initMax);
    		if ("lr" in $$props) $$invalidate(4, lr = $$props.lr);
    		if ("mo" in $$props) $$invalidate(5, mo = $$props.mo);
    		if ("simCount" in $$props) $$invalidate(6, simCount = $$props.simCount);
    		if ("learningRetries" in $$props) $$invalidate(7, learningRetries = $$props.learningRetries);
    		if ("isMultiProblem" in $$props) $$invalidate(8, isMultiProblem = $$props.isMultiProblem);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [
    		epochMax,
    		errorMin,
    		initMin,
    		initMax,
    		lr,
    		mo,
    		simCount,
    		learningRetries,
    		isMultiProblem,
    		input0_input_handler,
    		input1_input_handler,
    		input2_input_handler,
    		input3_input_handler,
    		input4_input_handler,
    		input5_input_handler,
    		input6_input_handler,
    		input_input_handler
    	];
    }

    class ParameterDisplay extends SvelteComponentDev {
    	constructor(options) {
    		super(options);

    		init(this, options, instance$3, create_fragment$3, safe_not_equal, {
    			epochMax: 0,
    			errorMin: 1,
    			initMin: 2,
    			initMax: 3,
    			lr: 4,
    			mo: 5,
    			simCount: 6,
    			learningRetries: 7,
    			isMultiProblem: 8
    		});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "ParameterDisplay",
    			options,
    			id: create_fragment$3.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*epochMax*/ ctx[0] === undefined && !("epochMax" in props)) {
    			console.warn("<ParameterDisplay> was created without expected prop 'epochMax'");
    		}

    		if (/*errorMin*/ ctx[1] === undefined && !("errorMin" in props)) {
    			console.warn("<ParameterDisplay> was created without expected prop 'errorMin'");
    		}

    		if (/*initMin*/ ctx[2] === undefined && !("initMin" in props)) {
    			console.warn("<ParameterDisplay> was created without expected prop 'initMin'");
    		}

    		if (/*initMax*/ ctx[3] === undefined && !("initMax" in props)) {
    			console.warn("<ParameterDisplay> was created without expected prop 'initMax'");
    		}

    		if (/*lr*/ ctx[4] === undefined && !("lr" in props)) {
    			console.warn("<ParameterDisplay> was created without expected prop 'lr'");
    		}

    		if (/*mo*/ ctx[5] === undefined && !("mo" in props)) {
    			console.warn("<ParameterDisplay> was created without expected prop 'mo'");
    		}

    		if (/*simCount*/ ctx[6] === undefined && !("simCount" in props)) {
    			console.warn("<ParameterDisplay> was created without expected prop 'simCount'");
    		}

    		if (/*learningRetries*/ ctx[7] === undefined && !("learningRetries" in props)) {
    			console.warn("<ParameterDisplay> was created without expected prop 'learningRetries'");
    		}

    		if (/*isMultiProblem*/ ctx[8] === undefined && !("isMultiProblem" in props)) {
    			console.warn("<ParameterDisplay> was created without expected prop 'isMultiProblem'");
    		}
    	}

    	get epochMax() {
    		throw new Error("<ParameterDisplay>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set epochMax(value) {
    		throw new Error("<ParameterDisplay>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get errorMin() {
    		throw new Error("<ParameterDisplay>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set errorMin(value) {
    		throw new Error("<ParameterDisplay>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get initMin() {
    		throw new Error("<ParameterDisplay>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set initMin(value) {
    		throw new Error("<ParameterDisplay>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get initMax() {
    		throw new Error("<ParameterDisplay>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set initMax(value) {
    		throw new Error("<ParameterDisplay>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get lr() {
    		throw new Error("<ParameterDisplay>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set lr(value) {
    		throw new Error("<ParameterDisplay>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get mo() {
    		throw new Error("<ParameterDisplay>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set mo(value) {
    		throw new Error("<ParameterDisplay>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get simCount() {
    		throw new Error("<ParameterDisplay>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set simCount(value) {
    		throw new Error("<ParameterDisplay>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get learningRetries() {
    		throw new Error("<ParameterDisplay>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set learningRetries(value) {
    		throw new Error("<ParameterDisplay>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get isMultiProblem() {
    		throw new Error("<ParameterDisplay>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set isMultiProblem(value) {
    		throw new Error("<ParameterDisplay>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/StudyDisplay.svelte generated by Svelte v3.38.3 */
    const file$1 = "src/components/StudyDisplay.svelte";

    // (71:54) 
    function create_if_block_2(ctx) {
    	let multipleproblemdisplay;
    	let current;

    	multipleproblemdisplay = new MultipleProblemDisplay({
    			props: {
    				results: /*multipleProblemStudyResults*/ ctx[4]
    			},
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			create_component(multipleproblemdisplay.$$.fragment);
    		},
    		m: function mount(target, anchor) {
    			mount_component(multipleproblemdisplay, target, anchor);
    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			const multipleproblemdisplay_changes = {};
    			if (dirty & /*multipleProblemStudyResults*/ 16) multipleproblemdisplay_changes.results = /*multipleProblemStudyResults*/ ctx[4];
    			multipleproblemdisplay.$set(multipleproblemdisplay_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(multipleproblemdisplay.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(multipleproblemdisplay.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(multipleproblemdisplay, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_2.name,
    		type: "if",
    		source: "(71:54) ",
    		ctx
    	});

    	return block;
    }

    // (69:16) {#if singleProblemStudyResults}
    function create_if_block_1$1(ctx) {
    	let singleproblemdisplay;
    	let current;

    	singleproblemdisplay = new SingleProblemDisplay({
    			props: {
    				results: /*singleProblemStudyResults*/ ctx[3]
    			},
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			create_component(singleproblemdisplay.$$.fragment);
    		},
    		m: function mount(target, anchor) {
    			mount_component(singleproblemdisplay, target, anchor);
    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			const singleproblemdisplay_changes = {};
    			if (dirty & /*singleProblemStudyResults*/ 8) singleproblemdisplay_changes.results = /*singleProblemStudyResults*/ ctx[3];
    			singleproblemdisplay.$set(singleproblemdisplay_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(singleproblemdisplay.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(singleproblemdisplay.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(singleproblemdisplay, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1$1.name,
    		type: "if",
    		source: "(69:16) {#if singleProblemStudyResults}",
    		ctx
    	});

    	return block;
    }

    // (79:20) {:else}
    function create_else_block(ctx) {
    	let button;

    	const block = {
    		c: function create() {
    			button = element("button");
    			button.textContent = "Running...";
    			button.disabled = true;
    			attr_dev(button, "class", "svelte-1ok8t64");
    			add_location(button, file$1, 79, 24, 3150);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, button, anchor);
    		},
    		p: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(button);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block.name,
    		type: "else",
    		source: "(79:20) {:else}",
    		ctx
    	});

    	return block;
    }

    // (77:20) {#if !studyRunning && !otherStudyRunning}
    function create_if_block$1(ctx) {
    	let button;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			button = element("button");
    			button.textContent = "Run Study";
    			attr_dev(button, "class", "svelte-1ok8t64");
    			add_location(button, file$1, 77, 24, 3051);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, button, anchor);

    			if (!mounted) {
    				dispose = listen_dev(button, "click", /*runStudy*/ ctx[5], false, false, false);
    				mounted = true;
    			}
    		},
    		p: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(button);
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$1.name,
    		type: "if",
    		source: "(77:20) {#if !studyRunning && !otherStudyRunning}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$2(ctx) {
    	let div5;
    	let div4;
    	let div0;
    	let t0_value = /*studyProps*/ ctx[0].title + "";
    	let t0;
    	let t1;
    	let div3;
    	let div1;
    	let img;
    	let img_src_value;
    	let t2;
    	let div2;
    	let t3_value = /*studyProps*/ ctx[0].description + "";
    	let t3;
    	let t4;
    	let parameterdisplay;
    	let updating_epochMax;
    	let updating_errorMin;
    	let updating_initMin;
    	let updating_initMax;
    	let updating_lr;
    	let updating_mo;
    	let updating_simCount;
    	let updating_learningRetries;
    	let t5;
    	let current_block_type_index;
    	let if_block0;
    	let t6;
    	let p;
    	let current;

    	function parameterdisplay_epochMax_binding(value) {
    		/*parameterdisplay_epochMax_binding*/ ctx[6](value);
    	}

    	function parameterdisplay_errorMin_binding(value) {
    		/*parameterdisplay_errorMin_binding*/ ctx[7](value);
    	}

    	function parameterdisplay_initMin_binding(value) {
    		/*parameterdisplay_initMin_binding*/ ctx[8](value);
    	}

    	function parameterdisplay_initMax_binding(value) {
    		/*parameterdisplay_initMax_binding*/ ctx[9](value);
    	}

    	function parameterdisplay_lr_binding(value) {
    		/*parameterdisplay_lr_binding*/ ctx[10](value);
    	}

    	function parameterdisplay_mo_binding(value) {
    		/*parameterdisplay_mo_binding*/ ctx[11](value);
    	}

    	function parameterdisplay_simCount_binding(value) {
    		/*parameterdisplay_simCount_binding*/ ctx[12](value);
    	}

    	function parameterdisplay_learningRetries_binding(value) {
    		/*parameterdisplay_learningRetries_binding*/ ctx[13](value);
    	}

    	let parameterdisplay_props = {
    		isMultiProblem: /*studyProps*/ ctx[0].trainingSets.length > 1 && /*studyProps*/ ctx[0].studyParams.retrainingMax > 0
    	};

    	if (/*studyProps*/ ctx[0].studyParams.epochMax !== void 0) {
    		parameterdisplay_props.epochMax = /*studyProps*/ ctx[0].studyParams.epochMax;
    	}

    	if (/*studyProps*/ ctx[0].studyParams.errMin !== void 0) {
    		parameterdisplay_props.errorMin = /*studyProps*/ ctx[0].studyParams.errMin;
    	}

    	if (/*studyProps*/ ctx[0].hyperParams.randMin !== void 0) {
    		parameterdisplay_props.initMin = /*studyProps*/ ctx[0].hyperParams.randMin;
    	}

    	if (/*studyProps*/ ctx[0].hyperParams.randMax !== void 0) {
    		parameterdisplay_props.initMax = /*studyProps*/ ctx[0].hyperParams.randMax;
    	}

    	if (/*studyProps*/ ctx[0].hyperParams.lr !== void 0) {
    		parameterdisplay_props.lr = /*studyProps*/ ctx[0].hyperParams.lr;
    	}

    	if (/*studyProps*/ ctx[0].hyperParams.mo !== void 0) {
    		parameterdisplay_props.mo = /*studyProps*/ ctx[0].hyperParams.mo;
    	}

    	if (/*studyProps*/ ctx[0].studyParams.simulations !== void 0) {
    		parameterdisplay_props.simCount = /*studyProps*/ ctx[0].studyParams.simulations;
    	}

    	if (/*studyProps*/ ctx[0].studyParams.retrainingMax !== void 0) {
    		parameterdisplay_props.learningRetries = /*studyProps*/ ctx[0].studyParams.retrainingMax;
    	}

    	parameterdisplay = new ParameterDisplay({
    			props: parameterdisplay_props,
    			$$inline: true
    		});

    	binding_callbacks.push(() => bind(parameterdisplay, "epochMax", parameterdisplay_epochMax_binding));
    	binding_callbacks.push(() => bind(parameterdisplay, "errorMin", parameterdisplay_errorMin_binding));
    	binding_callbacks.push(() => bind(parameterdisplay, "initMin", parameterdisplay_initMin_binding));
    	binding_callbacks.push(() => bind(parameterdisplay, "initMax", parameterdisplay_initMax_binding));
    	binding_callbacks.push(() => bind(parameterdisplay, "lr", parameterdisplay_lr_binding));
    	binding_callbacks.push(() => bind(parameterdisplay, "mo", parameterdisplay_mo_binding));
    	binding_callbacks.push(() => bind(parameterdisplay, "simCount", parameterdisplay_simCount_binding));
    	binding_callbacks.push(() => bind(parameterdisplay, "learningRetries", parameterdisplay_learningRetries_binding));
    	const if_block_creators = [create_if_block_1$1, create_if_block_2];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*singleProblemStudyResults*/ ctx[3]) return 0;
    		if (/*multipleProblemStudyResults*/ ctx[4]) return 1;
    		return -1;
    	}

    	if (~(current_block_type_index = select_block_type(ctx))) {
    		if_block0 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    	}

    	function select_block_type_1(ctx, dirty) {
    		if (!/*studyRunning*/ ctx[2] && !/*otherStudyRunning*/ ctx[1]) return create_if_block$1;
    		return create_else_block;
    	}

    	let current_block_type = select_block_type_1(ctx);
    	let if_block1 = current_block_type(ctx);

    	const block = {
    		c: function create() {
    			div5 = element("div");
    			div4 = element("div");
    			div0 = element("div");
    			t0 = text(t0_value);
    			t1 = space();
    			div3 = element("div");
    			div1 = element("div");
    			img = element("img");
    			t2 = space();
    			div2 = element("div");
    			t3 = text(t3_value);
    			t4 = space();
    			create_component(parameterdisplay.$$.fragment);
    			t5 = space();
    			if (if_block0) if_block0.c();
    			t6 = space();
    			p = element("p");
    			if_block1.c();
    			attr_dev(div0, "class", "studyTitle");
    			add_location(div0, file$1, 43, 8, 1469);
    			attr_dev(img, "class", "studyImage svelte-1ok8t64");
    			if (img.src !== (img_src_value = /*studyProps*/ ctx[0].image)) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "alt", "Network architecture");
    			add_location(img, file$1, 48, 16, 1632);
    			attr_dev(div1, "class", "imageContainer svelte-1ok8t64");
    			add_location(div1, file$1, 47, 12, 1587);
    			add_location(p, file$1, 75, 16, 2961);
    			attr_dev(div2, "class", "studyDescription svelte-1ok8t64");
    			add_location(div2, file$1, 54, 12, 1816);
    			attr_dev(div3, "class", "studyDetails svelte-1ok8t64");
    			add_location(div3, file$1, 46, 8, 1548);
    			attr_dev(div4, "class", "study svelte-1ok8t64");
    			add_location(div4, file$1, 42, 4, 1441);
    			attr_dev(div5, "class", "content svelte-1ok8t64");
    			add_location(div5, file$1, 41, 0, 1415);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div5, anchor);
    			append_dev(div5, div4);
    			append_dev(div4, div0);
    			append_dev(div0, t0);
    			append_dev(div4, t1);
    			append_dev(div4, div3);
    			append_dev(div3, div1);
    			append_dev(div1, img);
    			append_dev(div3, t2);
    			append_dev(div3, div2);
    			append_dev(div2, t3);
    			append_dev(div2, t4);
    			mount_component(parameterdisplay, div2, null);
    			append_dev(div2, t5);

    			if (~current_block_type_index) {
    				if_blocks[current_block_type_index].m(div2, null);
    			}

    			append_dev(div2, t6);
    			append_dev(div2, p);
    			if_block1.m(p, null);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			if ((!current || dirty & /*studyProps*/ 1) && t0_value !== (t0_value = /*studyProps*/ ctx[0].title + "")) set_data_dev(t0, t0_value);

    			if (!current || dirty & /*studyProps*/ 1 && img.src !== (img_src_value = /*studyProps*/ ctx[0].image)) {
    				attr_dev(img, "src", img_src_value);
    			}

    			if ((!current || dirty & /*studyProps*/ 1) && t3_value !== (t3_value = /*studyProps*/ ctx[0].description + "")) set_data_dev(t3, t3_value);
    			const parameterdisplay_changes = {};
    			if (dirty & /*studyProps*/ 1) parameterdisplay_changes.isMultiProblem = /*studyProps*/ ctx[0].trainingSets.length > 1 && /*studyProps*/ ctx[0].studyParams.retrainingMax > 0;

    			if (!updating_epochMax && dirty & /*studyProps*/ 1) {
    				updating_epochMax = true;
    				parameterdisplay_changes.epochMax = /*studyProps*/ ctx[0].studyParams.epochMax;
    				add_flush_callback(() => updating_epochMax = false);
    			}

    			if (!updating_errorMin && dirty & /*studyProps*/ 1) {
    				updating_errorMin = true;
    				parameterdisplay_changes.errorMin = /*studyProps*/ ctx[0].studyParams.errMin;
    				add_flush_callback(() => updating_errorMin = false);
    			}

    			if (!updating_initMin && dirty & /*studyProps*/ 1) {
    				updating_initMin = true;
    				parameterdisplay_changes.initMin = /*studyProps*/ ctx[0].hyperParams.randMin;
    				add_flush_callback(() => updating_initMin = false);
    			}

    			if (!updating_initMax && dirty & /*studyProps*/ 1) {
    				updating_initMax = true;
    				parameterdisplay_changes.initMax = /*studyProps*/ ctx[0].hyperParams.randMax;
    				add_flush_callback(() => updating_initMax = false);
    			}

    			if (!updating_lr && dirty & /*studyProps*/ 1) {
    				updating_lr = true;
    				parameterdisplay_changes.lr = /*studyProps*/ ctx[0].hyperParams.lr;
    				add_flush_callback(() => updating_lr = false);
    			}

    			if (!updating_mo && dirty & /*studyProps*/ 1) {
    				updating_mo = true;
    				parameterdisplay_changes.mo = /*studyProps*/ ctx[0].hyperParams.mo;
    				add_flush_callback(() => updating_mo = false);
    			}

    			if (!updating_simCount && dirty & /*studyProps*/ 1) {
    				updating_simCount = true;
    				parameterdisplay_changes.simCount = /*studyProps*/ ctx[0].studyParams.simulations;
    				add_flush_callback(() => updating_simCount = false);
    			}

    			if (!updating_learningRetries && dirty & /*studyProps*/ 1) {
    				updating_learningRetries = true;
    				parameterdisplay_changes.learningRetries = /*studyProps*/ ctx[0].studyParams.retrainingMax;
    				add_flush_callback(() => updating_learningRetries = false);
    			}

    			parameterdisplay.$set(parameterdisplay_changes);
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if (~current_block_type_index) {
    					if_blocks[current_block_type_index].p(ctx, dirty);
    				}
    			} else {
    				if (if_block0) {
    					group_outros();

    					transition_out(if_blocks[previous_block_index], 1, 1, () => {
    						if_blocks[previous_block_index] = null;
    					});

    					check_outros();
    				}

    				if (~current_block_type_index) {
    					if_block0 = if_blocks[current_block_type_index];

    					if (!if_block0) {
    						if_block0 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    						if_block0.c();
    					} else {
    						if_block0.p(ctx, dirty);
    					}

    					transition_in(if_block0, 1);
    					if_block0.m(div2, t6);
    				} else {
    					if_block0 = null;
    				}
    			}

    			if (current_block_type === (current_block_type = select_block_type_1(ctx)) && if_block1) {
    				if_block1.p(ctx, dirty);
    			} else {
    				if_block1.d(1);
    				if_block1 = current_block_type(ctx);

    				if (if_block1) {
    					if_block1.c();
    					if_block1.m(p, null);
    				}
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(parameterdisplay.$$.fragment, local);
    			transition_in(if_block0);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(parameterdisplay.$$.fragment, local);
    			transition_out(if_block0);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div5);
    			destroy_component(parameterdisplay);

    			if (~current_block_type_index) {
    				if_blocks[current_block_type_index].d();
    			}

    			if_block1.d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$2.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("StudyDisplay", slots, []);
    	
    	
    	
    	let { studyProps } = $$props;
    	let { otherStudyRunning } = $$props;
    	const dispatch = createEventDispatcher();
    	let studyRunning = false;
    	let singleProblemStudyResults;
    	let multipleProblemStudyResults;

    	function runStudy() {
    		$$invalidate(2, studyRunning = true);
    		dispatch("running");

    		setTimeout(
    			() => {
    				if (studyProps.trainingSets.length === 1) {
    					singleProblemStudy(studyProps.hyperParams, studyProps.trainingSets[0], studyProps.studyParams, singleProblemCompleteCallback);
    				} else if (studyProps.trainingSets.length > 1) {
    					multiProblemStudy(studyProps.hyperParams, studyProps.trainingSets, studyProps.studyParams, multipleProblemCompleteCallback);
    				}
    			},
    			1
    		);
    	}

    	function stopStudy() {
    		$$invalidate(2, studyRunning = false);
    		dispatch("stopped");
    	}

    	function singleProblemCompleteCallback(studyResults) {
    		stopStudy();
    		$$invalidate(3, singleProblemStudyResults = studyResults);
    	}

    	function multipleProblemCompleteCallback(studyResults) {
    		stopStudy();
    		$$invalidate(4, multipleProblemStudyResults = studyResults);
    	}

    	const writable_props = ["studyProps", "otherStudyRunning"];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<StudyDisplay> was created with unknown prop '${key}'`);
    	});

    	function parameterdisplay_epochMax_binding(value) {
    		if ($$self.$$.not_equal(studyProps.studyParams.epochMax, value)) {
    			studyProps.studyParams.epochMax = value;
    			$$invalidate(0, studyProps);
    		}
    	}

    	function parameterdisplay_errorMin_binding(value) {
    		if ($$self.$$.not_equal(studyProps.studyParams.errMin, value)) {
    			studyProps.studyParams.errMin = value;
    			$$invalidate(0, studyProps);
    		}
    	}

    	function parameterdisplay_initMin_binding(value) {
    		if ($$self.$$.not_equal(studyProps.hyperParams.randMin, value)) {
    			studyProps.hyperParams.randMin = value;
    			$$invalidate(0, studyProps);
    		}
    	}

    	function parameterdisplay_initMax_binding(value) {
    		if ($$self.$$.not_equal(studyProps.hyperParams.randMax, value)) {
    			studyProps.hyperParams.randMax = value;
    			$$invalidate(0, studyProps);
    		}
    	}

    	function parameterdisplay_lr_binding(value) {
    		if ($$self.$$.not_equal(studyProps.hyperParams.lr, value)) {
    			studyProps.hyperParams.lr = value;
    			$$invalidate(0, studyProps);
    		}
    	}

    	function parameterdisplay_mo_binding(value) {
    		if ($$self.$$.not_equal(studyProps.hyperParams.mo, value)) {
    			studyProps.hyperParams.mo = value;
    			$$invalidate(0, studyProps);
    		}
    	}

    	function parameterdisplay_simCount_binding(value) {
    		if ($$self.$$.not_equal(studyProps.studyParams.simulations, value)) {
    			studyProps.studyParams.simulations = value;
    			$$invalidate(0, studyProps);
    		}
    	}

    	function parameterdisplay_learningRetries_binding(value) {
    		if ($$self.$$.not_equal(studyProps.studyParams.retrainingMax, value)) {
    			studyProps.studyParams.retrainingMax = value;
    			$$invalidate(0, studyProps);
    		}
    	}

    	$$self.$$set = $$props => {
    		if ("studyProps" in $$props) $$invalidate(0, studyProps = $$props.studyProps);
    		if ("otherStudyRunning" in $$props) $$invalidate(1, otherStudyRunning = $$props.otherStudyRunning);
    	};

    	$$self.$capture_state = () => ({
    		createEventDispatcher,
    		singleProblemStudy,
    		multiProblemStudy,
    		SingleProblemDisplay,
    		MultipleProblemDisplay,
    		ParameterDisplay,
    		studyProps,
    		otherStudyRunning,
    		dispatch,
    		studyRunning,
    		singleProblemStudyResults,
    		multipleProblemStudyResults,
    		runStudy,
    		stopStudy,
    		singleProblemCompleteCallback,
    		multipleProblemCompleteCallback
    	});

    	$$self.$inject_state = $$props => {
    		if ("studyProps" in $$props) $$invalidate(0, studyProps = $$props.studyProps);
    		if ("otherStudyRunning" in $$props) $$invalidate(1, otherStudyRunning = $$props.otherStudyRunning);
    		if ("studyRunning" in $$props) $$invalidate(2, studyRunning = $$props.studyRunning);
    		if ("singleProblemStudyResults" in $$props) $$invalidate(3, singleProblemStudyResults = $$props.singleProblemStudyResults);
    		if ("multipleProblemStudyResults" in $$props) $$invalidate(4, multipleProblemStudyResults = $$props.multipleProblemStudyResults);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [
    		studyProps,
    		otherStudyRunning,
    		studyRunning,
    		singleProblemStudyResults,
    		multipleProblemStudyResults,
    		runStudy,
    		parameterdisplay_epochMax_binding,
    		parameterdisplay_errorMin_binding,
    		parameterdisplay_initMin_binding,
    		parameterdisplay_initMax_binding,
    		parameterdisplay_lr_binding,
    		parameterdisplay_mo_binding,
    		parameterdisplay_simCount_binding,
    		parameterdisplay_learningRetries_binding
    	];
    }

    class StudyDisplay extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, { studyProps: 0, otherStudyRunning: 1 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "StudyDisplay",
    			options,
    			id: create_fragment$2.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*studyProps*/ ctx[0] === undefined && !("studyProps" in props)) {
    			console.warn("<StudyDisplay> was created without expected prop 'studyProps'");
    		}

    		if (/*otherStudyRunning*/ ctx[1] === undefined && !("otherStudyRunning" in props)) {
    			console.warn("<StudyDisplay> was created without expected prop 'otherStudyRunning'");
    		}
    	}

    	get studyProps() {
    		throw new Error("<StudyDisplay>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set studyProps(value) {
    		throw new Error("<StudyDisplay>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get otherStudyRunning() {
    		throw new Error("<StudyDisplay>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set otherStudyRunning(value) {
    		throw new Error("<StudyDisplay>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/NPStudiesHome.svelte generated by Svelte v3.38.3 */
    const file = "src/components/NPStudiesHome.svelte";

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[4] = list[i];
    	child_ctx[6] = i;
    	return child_ctx;
    }

    // (22:4) {#each studies as studyProps, index}
    function create_each_block(ctx) {
    	let div;
    	let studydisplay;
    	let current;

    	function running_handler() {
    		return /*running_handler*/ ctx[2](/*index*/ ctx[6]);
    	}

    	studydisplay = new StudyDisplay({
    			props: {
    				studyProps: /*studyProps*/ ctx[4],
    				otherStudyRunning: /*activeStudyIndex*/ ctx[0] != /*index*/ ctx[6] && /*activeStudyIndex*/ ctx[0] != -1
    			},
    			$$inline: true
    		});

    	studydisplay.$on("running", running_handler);
    	studydisplay.$on("stopped", /*stopped_handler*/ ctx[3]);

    	const block = {
    		c: function create() {
    			div = element("div");
    			create_component(studydisplay.$$.fragment);
    			attr_dev(div, "class", "study svelte-hba44x");
    			add_location(div, file, 22, 8, 889);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			mount_component(studydisplay, div, null);
    			current = true;
    		},
    		p: function update(new_ctx, dirty) {
    			ctx = new_ctx;
    			const studydisplay_changes = {};
    			if (dirty & /*activeStudyIndex*/ 1) studydisplay_changes.otherStudyRunning = /*activeStudyIndex*/ ctx[0] != /*index*/ ctx[6] && /*activeStudyIndex*/ ctx[0] != -1;
    			studydisplay.$set(studydisplay_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(studydisplay.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(studydisplay.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			destroy_component(studydisplay);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block.name,
    		type: "each",
    		source: "(22:4) {#each studies as studyProps, index}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$1(ctx) {
    	let div3;
    	let div0;
    	let t1;
    	let div1;
    	let t3;
    	let t4;
    	let div2;
    	let button0;
    	let t6;
    	let button1;
    	let current;
    	let mounted;
    	let dispose;
    	let each_value = studyArr;
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	const out = i => transition_out(each_blocks[i], 1, 1, () => {
    		each_blocks[i] = null;
    	});

    	const block = {
    		c: function create() {
    			div3 = element("div");
    			div0 = element("div");
    			div0.textContent = "Studies for the research publication:";
    			t1 = space();
    			div1 = element("div");
    			div1.textContent = "\"Neural network process simulations support a distributed memory system\n        and aid design of a novel computer adaptive digital memory test for\n        preclinical and prodromal Alzheimer’s disease\" (in preparation)";
    			t3 = space();

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t4 = space();
    			div2 = element("div");
    			button0 = element("button");
    			button0.textContent = "Return Home";
    			t6 = space();
    			button1 = element("button");
    			button1.textContent = "Source Code on Github";
    			attr_dev(div0, "class", "subtitle");
    			add_location(div0, file, 15, 4, 504);
    			attr_dev(div1, "class", "articleTitle svelte-hba44x");
    			add_location(div1, file, 16, 4, 574);
    			attr_dev(button0, "class", "navButton svelte-hba44x");
    			add_location(button0, file, 33, 8, 1272);
    			attr_dev(button1, "class", "navButton svelte-hba44x");
    			add_location(button1, file, 34, 8, 1348);
    			attr_dev(div2, "class", "navigation svelte-hba44x");
    			add_location(div2, file, 32, 4, 1239);
    			attr_dev(div3, "class", "content svelte-hba44x");
    			add_location(div3, file, 14, 0, 478);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div3, anchor);
    			append_dev(div3, div0);
    			append_dev(div3, t1);
    			append_dev(div3, div1);
    			append_dev(div3, t3);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div3, null);
    			}

    			append_dev(div3, t4);
    			append_dev(div3, div2);
    			append_dev(div2, button0);
    			append_dev(div2, t6);
    			append_dev(div2, button1);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", /*homeClick*/ ctx[1], false, false, false),
    					listen_dev(button1, "click", githubClick, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*studies, activeStudyIndex*/ 1) {
    				each_value = studyArr;
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    						transition_in(each_blocks[i], 1);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						transition_in(each_blocks[i], 1);
    						each_blocks[i].m(div3, t4);
    					}
    				}

    				group_outros();

    				for (i = each_value.length; i < each_blocks.length; i += 1) {
    					out(i);
    				}

    				check_outros();
    			}
    		},
    		i: function intro(local) {
    			if (current) return;

    			for (let i = 0; i < each_value.length; i += 1) {
    				transition_in(each_blocks[i]);
    			}

    			current = true;
    		},
    		o: function outro(local) {
    			each_blocks = each_blocks.filter(Boolean);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				transition_out(each_blocks[i]);
    			}

    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div3);
    			destroy_each(each_blocks, detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$1.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function githubClick() {
    	window.location.href = "https://github.com/MayoNeurologyAI/NeuralNetworksNeuropsychology";
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("NPStudiesHome", slots, []);
    	let activeStudyIndex = -1;

    	function homeClick() {
    		routingStore.set(RoutingLocation.Home);
    	}

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<NPStudiesHome> was created with unknown prop '${key}'`);
    	});

    	const running_handler = index => $$invalidate(0, activeStudyIndex = index);
    	const stopped_handler = () => $$invalidate(0, activeStudyIndex = -1);

    	$$self.$capture_state = () => ({
    		studies: studyArr,
    		StudyDisplay,
    		routingStore,
    		RoutingLocation,
    		activeStudyIndex,
    		homeClick,
    		githubClick
    	});

    	$$self.$inject_state = $$props => {
    		if ("activeStudyIndex" in $$props) $$invalidate(0, activeStudyIndex = $$props.activeStudyIndex);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [activeStudyIndex, homeClick, running_handler, stopped_handler];
    }

    class NPStudiesHome extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "NPStudiesHome",
    			options,
    			id: create_fragment$1.name
    		});
    	}
    }

    /* src/App.svelte generated by Svelte v3.38.3 */

    // (13:59) 
    function create_if_block_1(ctx) {
    	let npstudieshome;
    	let current;
    	npstudieshome = new NPStudiesHome({ $$inline: true });

    	const block = {
    		c: function create() {
    			create_component(npstudieshome.$$.fragment);
    		},
    		m: function mount(target, anchor) {
    			mount_component(npstudieshome, target, anchor);
    			current = true;
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(npstudieshome.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(npstudieshome.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(npstudieshome, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1.name,
    		type: "if",
    		source: "(13:59) ",
    		ctx
    	});

    	return block;
    }

    // (11:0) {#if routeLocation === RoutingLocation.Home}
    function create_if_block(ctx) {
    	let home;
    	let current;
    	home = new Home({ $$inline: true });

    	const block = {
    		c: function create() {
    			create_component(home.$$.fragment);
    		},
    		m: function mount(target, anchor) {
    			mount_component(home, target, anchor);
    			current = true;
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(home.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(home.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(home, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block.name,
    		type: "if",
    		source: "(11:0) {#if routeLocation === RoutingLocation.Home}",
    		ctx
    	});

    	return block;
    }

    function create_fragment(ctx) {
    	let current_block_type_index;
    	let if_block;
    	let if_block_anchor;
    	let current;
    	const if_block_creators = [create_if_block, create_if_block_1];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*routeLocation*/ ctx[0] === RoutingLocation.Home) return 0;
    		if (/*routeLocation*/ ctx[0] === RoutingLocation.NPPaperStudies) return 1;
    		return -1;
    	}

    	if (~(current_block_type_index = select_block_type(ctx))) {
    		if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    	}

    	const block = {
    		c: function create() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			if (~current_block_type_index) {
    				if_blocks[current_block_type_index].m(target, anchor);
    			}

    			insert_dev(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index !== previous_block_index) {
    				if (if_block) {
    					group_outros();

    					transition_out(if_blocks[previous_block_index], 1, 1, () => {
    						if_blocks[previous_block_index] = null;
    					});

    					check_outros();
    				}

    				if (~current_block_type_index) {
    					if_block = if_blocks[current_block_type_index];

    					if (!if_block) {
    						if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    						if_block.c();
    					}

    					transition_in(if_block, 1);
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				} else {
    					if_block = null;
    				}
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (~current_block_type_index) {
    				if_blocks[current_block_type_index].d(detaching);
    			}

    			if (detaching) detach_dev(if_block_anchor);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("App", slots, []);
    	let routeLocation;

    	routingStore.subscribe(location => {
    		$$invalidate(0, routeLocation = location);
    	});

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({
    		Home,
    		routingStore,
    		RoutingLocation,
    		NpStudiesHome: NPStudiesHome,
    		routeLocation
    	});

    	$$self.$inject_state = $$props => {
    		if ("routeLocation" in $$props) $$invalidate(0, routeLocation = $$props.routeLocation);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [routeLocation];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment.name
    		});
    	}
    }

    const app = new App({
        target: document.body,
        props: {}
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
