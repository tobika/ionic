import { CSS, rafFrames, nativeRaf, transitionEnd, nativeTimeout } from '../util/dom';
import { assign, isDefined } from '../util/util';


/**
 * @private
 *
 * - play
 * - Add before classes - DOM WRITE
 * - Remove before classes - DOM WRITE
 * - Add before inline styles - DOM WRITE
 * - set inline FROM styles - DOM WRITE
 * - RAF
 * - run before functions that have dom reads - DOM READ
 * - run before functions that have dom writes - DOM WRITE
 * - set css transition duration/easing - DOM WRITE
 * - RAF
 * - set inline TO styles - DOM WRITE
 */
export class Animation {
  private _parent: Animation;
  private _c: Animation[] = [];
  private _el: HTMLElement[] = [];
  private _fx: {[key: string]: EffectProperty} = {};
  private _dur: number = null;
  private _easing: string = null;
  private _bfSty: { [property: string]: any; } = {};
  private _bfAdd: string[] = [];
  private _bfRmv: string[] = [];
  private _afSty: { [property: string]: any; } = {};
  private _afAdd: string[] = [];
  private _afRmv: string[] = [];
  private _bfReadFns: Function[] = [];
  private _bfWriteFns: Function[] = [];
  private _fFns: Function[] = [];
  private _fOnceFns: Function[] = [];
  private _rv: boolean = false;
  private _unregTrans: Function;
  private _tmr: number;
  private _lastUpd: number;
  private _hasDur: boolean;
  private _isAsync: boolean;

  opts: AnimationOptions;
  isPlaying: boolean = false;
  hasTween: boolean = false;
  hasCompleted: boolean = false;

  constructor(ele?: any, opts?: AnimationOptions) {
    this.element(ele);
    this.opts = opts;
  }

  /**
   * @internal
   * NO DOM
   */
  _reset() {
    this._fx = {};
    this._bfSty = {};
    this._afSty = {};

    this._el.length = this._c.length = this._bfAdd.length = this._bfRmv.length = this._afAdd.length = this._afRmv.length = this._fFns.length = this._bfReadFns.length = this._bfWriteFns.length = this._fOnceFns.length = 0;
    this._easing = this._dur = this.opts = this._unregTrans = null;
  }

  element(ele: any): Animation {
    if (ele) {
      if (typeof ele === 'string') {
        ele = document.querySelectorAll(ele);
        for (var i = 0; i < ele.length; i++) {
          this._addEle(ele[i]);
        }

      } else if (ele.length) {
        for (var i = 0; i < ele.length; i++) {
          this._addEle(ele[i]);
        }

      } else {
        this._addEle(ele);
      }
    }

    return this;
  }

  /**
   * @internal
   * NO DOM
   */
  private _addEle(ele: any) {
    if (ele.nativeElement) {
      ele = ele.nativeElement;
    }

    if (ele.nodeType === 1) {
      this._el.push(ele);
    }
  }

  /**
   * NO DOM
   */
  parent(parentAnimation: Animation): Animation {
    this._parent = parentAnimation;
    return this;
  }

  /**
   * NO DOM
   */
  add(childAnimation: Animation): Animation {
    childAnimation.parent(this);
    this._c.push(childAnimation);
    return this;
  }

  /**
   * NO DOM
   */
  getDuration(opts?: PlayOptions): number {
    return (opts && isDefined(opts.duration) ? opts.duration : this._dur !== null ? this._dur : (this._parent && this._parent.getDuration()) || 0);
  }

  /**
   * NO DOM
   */
  duration(milliseconds: number): Animation {
    this._dur = milliseconds;
    return this;
  }

  /**
   * NO DOM
   */
  getEasing(): string {
    return this._easing !== null ? this._easing : (this._parent && this._parent.getEasing()) || null;
  }

  /**
   * NO DOM
   */
  easing(name: string): Animation {
    this._easing = name;
    return this;
  }

  /**
   * NO DOM
   */
  from(prop: string, val: any): Animation {
    this._addProp('from', prop, val);
    return this;
  }

  /**
   * NO DOM
   */
  to(prop: string, val: any, clearProperyAfterTransition?: boolean): Animation {
    const fx: EffectProperty = this._addProp('to', prop, val);

    if (clearProperyAfterTransition) {
      // if this effect is a transform then clear the transform effect
      // otherwise just clear the actual property
      this.after.clearStyles([ fx.trans ? CSS.transform : prop]);
    }

    return this;
  }

  /**
   * NO DOM
   */
  fromTo(prop: string, fromVal: any, toVal: any, clearProperyAfterTransition?: boolean): Animation {
    return this.from(prop, fromVal).to(prop, toVal, clearProperyAfterTransition);
  }

  /**
   * @internal
   * NO DOM
   */
  private _addProp(state: string, prop: string, val: any): EffectProperty {
    var fxProp: EffectProperty = this._fx[prop];

    if (!fxProp) {
      // first time we've see this EffectProperty
      fxProp = this._fx[prop] = {
        trans: (TRANSFORMS[prop] === 1)
      };
    }

    // add from/to EffectState to the EffectProperty
    var fxState: EffectState = (<any>fxProp)[state] = {
      val: val,
      num: null,
      unit: '',
    };

    if (typeof val === 'string' && val.indexOf(' ') < 0) {
      let r = val.match(CSS_VALUE_REGEX);
      let num = parseFloat(r[1]);

      if (!isNaN(num)) {
        fxState.num = num;
      }
      fxState.unit = (r[0] !== r[2] ? r[2] : '');

    } else if (typeof val === 'number') {
      fxState.num = val;
    }

    return fxProp;
  }

  /**
   * NO DOM
   */
  get before() {
    return {
      addClass: (className: string): Animation => {
        this._bfAdd.push(className);
        return this;
      },
      removeClass: (className: string): Animation => {
        this._bfRmv.push(className);
        return this;
      },
      setStyles: (styles: { [property: string]: any; }): Animation => {
        this._bfSty = styles;
        return this;
      },
      clearStyles: (propertyNames: string[]): Animation => {
        for (var i = 0; i < propertyNames.length; i++) {
          this._bfSty[propertyNames[i]] = '';
        }
        return this;
      },
      addDomReadFn: (domReadFn: Function): Animation => {
        this._bfReadFns.push(domReadFn);
        return this;
      },
      addDomWriteFn: (domWriteFn: Function): Animation => {
        this._bfWriteFns.push(domWriteFn);
        return this;
      }
    };
  }

  /**
   * NO DOM
   */
  get after() {
    return {
      addClass: (className: string): Animation => {
        this._afAdd.push(className);
        return this;
      },
      removeClass: (className: string): Animation => {
        this._afRmv.push(className);
        return this;
      },
      setStyles: (styles: { [property: string]: any; }): Animation => {
        this._afSty = styles;
        return this;
      },
      clearStyles: (propertyNames: string[]): Animation => {
        for (var i = 0; i < propertyNames.length; i++) {
          this._afSty[propertyNames[i]] = '';
        }
        return this;
      }
    };
  }

  /**
   * DOM WRITE
   * NO RECURSION
   * ROOT ANIMATION
   */
  play(opts?: PlayOptions) {
    const dur = this.getDuration(opts);

    console.debug('Animation, play, duration', dur, 'easing', this._easing);

    // this is the top level animation and is in full control
    // of when the async play() should actually kick off
    // if there is no duration then it'll set the TO property immediately
    // if there is a duration, then it'll stage all animations at the
    // FROM property and transition duration, wait a few frames, then
    // kick off the animation by setting the TO property for each animation
    this._isAsync = this._hasDuration(opts);

    // ensure all past transition end events have been cleared
    this._clearAsync();

    // recursively kicks off the correct progress step for each child animation
    this._playInit(opts);

    if (this._isAsync) {
      // for the root animation only
      // set the async TRANSITION END event
      // and run onFinishes when the transition ends
      // ******** DOM WRITE ****************
      this._asyncEnd(dur, true);
    }

    // wait a frame for the DOM to get updated from all initial animation writes
    nativeRaf(this._playDomInspect.bind(this, opts));
  }

  /**
   * @internal
   * DOM WRITE
   * RECURSION
   */
  _playInit(opts: PlayOptions) {
    // init play
    // before _playDomInspect

    // always default that an animation does not tween
    // a tween requires that an Animation class has an element
    // and that it has at least one FROM/TO effect
    // and that the FROM/TO effect can tween numeric values
    this.hasTween = false;
    this.isPlaying = true;
    this.hasCompleted = false;
    this._hasDur = (this.getDuration(opts) > ANIMATION_DURATION_MIN);

    for (var i = 0; i < this._c.length; i++) {
      this._c[i]._playInit(opts);
    }

    if (this._hasDur) {
      // if there is a duration then we want to start at step 0
      this._progress(0);
    }
  }

  /**
   * @internal
   * DOM READ / WRITE
   * NO RECURSION
   * ROOT ANIMATION
   */
  _playDomInspect(opts: PlayOptions) {
    // after _playInit and RAF

    // fire off all the "before" function that have DOM READS in them
    // elements will be in the DOM, however visibily hidden
    // so we can read their dimensions if need be
    // ******** DOM READ ****************
    this._beforeReadFn();

    // ******** DOM READS ABOVE / DOM WRITES BELOW ****************

    // fire off all the "before" function that have DOM WRITES in them
    // ******** DOM WRITE ****************
    this._beforeWriteFn();

    // ******** DOM WRITE ****************
    this._playProgress(opts);

    if (this._isAsync) {
      // this animation has a duration so we need another RAF
      // for the CSS TRANSITION properties to kick in
      nativeRaf(this._playAnimate.bind(this, opts));

    } else {
      // no animation, so kick off all the finish callbacks
      this._didFinish(true);
    }
  }

  /**
   * DOM WRITE
   * RECURSION
   */
  _playProgress(opts: PlayOptions) {
    // after _playDomInspect
    // before _playAnimate

    for (var i = 0; i < this._c.length; i++) {
      // ******** DOM WRITE ****************
      this._c[i]._playProgress(opts);
    }

    // stage all of the before css classes and inline styles
    // ******** DOM WRITE ****************
    this._before();

    if (this._hasDur) {
      // set the CSS TRANSITION duration/easing
      // ******** DOM WRITE ****************
      this._setTrans(this.getDuration(opts), false);

    } else {
      // this animation does not have a duration, so it should not animate
      // just go straight to the TO properties and call it done
      // ******** DOM WRITE ****************
      this._progress(1);

      // since there was no animation, immediately run the after
      // ******** DOM WRITE ****************
      this._after();
    }
  }

  /**
   * @internal
   * DOM WRITE
   * RECURSION
   */
  _playAnimate() {
    // after _playProgress

    for (var i = 0; i < this._c.length; i++) {
      // ******** DOM WRITE ****************
      this._c[i]._playAnimate();
    }

    if (this._hasDur) {
      // browser had some time to render everything in place
      // and the transition duration/easing is set
      // now set the TO properties
      // which will trigger the transition to begin
      // ******** DOM WRITE ****************
      this._progress(1);
    }
  }

  /**
   * @internal
   * DOM WRITE
   * NO RECURSION
   */
  _asyncEnd(dur: number, shouldComplete: boolean) {
    var self = this;

    function onTransitionEnd(ev: any) {
      // congrats! a successful transition completed!
      console.debug('Animation onTransitionEnd', ev.target.nodeName, ev.propertyName);

      // ensure transition end events and timeouts have been cleared
      self._clearAsync();

      // ******** DOM WRITE ****************
      self._playEnd(false);

      // transition finished
      self._didFinish(shouldComplete);
    }

    function onTransitionFallback() {
      console.debug('Animation onTransitionFallback, CSS onTransitionEnd did not fire!');
      // oh noz! the transition end event didn't fire in time!
      // instead the fallback timer when first
      // if all goes well this fallback should never fire

      // clear the other async end events from firing
      self._tmr = 0;
      self._clearAsync();

      // set the after styles
      // ******** DOM WRITE ****************
      self._playEnd(true);

      // transition finished
      self._didFinish(shouldComplete);
    }

    // set the TRANSITION END event on one of the transition elements
    self._unregTrans = transitionEnd(self._transEl(), onTransitionEnd);

    // set a fallback timeout if the transition end event never fires, or is too slow
    // transition end fallback: (animation duration + XXms)
    self._tmr = nativeTimeout(onTransitionFallback, (dur + TRANSITION_END_FALLBACK_PADDING_MS));
  }

  /**
   * @internal
   * DOM WRITE
   * RECURSION
   */
  _playEnd(progressEnd: boolean) {
    for (var i = 0; i < this._c.length; i++) {
      // ******** DOM WRITE ****************
      this._c[i]._playEnd(progressEnd);
    }

    if (this._hasDur) {
      if (progressEnd) {
        // too late to have a smooth animation, just finish it
        // ******** DOM WRITE ****************
        this._setTrans(0, true);

        // ensure the ending progress step gets rendered
        // ******** DOM WRITE ****************
        this._progress(1);
      }

      // set the after styles
      // ******** DOM WRITE ****************
      this._after();
    }
  }

  /**
   * @internal
   * RECURSION
   */
  _hasDuration(opts: PlayOptions) {
    if (this.getDuration(opts) > ANIMATION_DURATION_MIN) {
      return true;
    }

    for (var i = 0; i < this._c.length; i++) {
      if (this._c[i]._hasDuration(opts)) {
        return true;
      }
    }

    return false;
  }

  /**
   * DOM WRITE
   * NO RECURSION
   */
  stop() {
    // ensure all past transition end events have been cleared
    this._clearAsync();
    this._hasDur = true;
    this._playEnd(true);
  }

  /**
   * @internal
   * NO DOM
   * NO RECURSION
   */
  _clearAsync() {
    this._unregTrans && this._unregTrans();
    if (this._tmr) {
      clearTimeout(this._tmr);
      this._tmr = 0;
    }
  }

  /**
   * @internal
   * DOM WRITE
   * NO RECURSION
   */
  _progress(stepValue: number) {
    // bread 'n butter
    var val: any;

    if (this._fx && this._el.length) {
      // flip the number if we're going in reverse
      if (this._rv) {
        stepValue = ((stepValue * -1) + 1);
      }
      var transforms: string[] = [];

      for (var prop in this._fx) {
        var fx = this._fx[prop];

        if (fx.from && fx.to) {

          var tweenEffect = (fx.from.num !== fx.to.num);
          if (tweenEffect) {
            this.hasTween = true;
          }

          if (stepValue === 0) {
            // FROM
            val = fx.from.val;

          } else if (stepValue === 1) {
            // TO
            val = fx.to.val;

          } else if (tweenEffect) {
            // EVERYTHING IN BETWEEN
            val = (((fx.to.num - fx.from.num) * stepValue) + fx.from.num) + fx.to.unit;

          } else {
            val = null;
          }

          if (val !== null) {
            if (fx.trans) {
              transforms.push(prop + '(' + val + ')');

            } else {
              for (var i = 0; i < this._el.length; i++) {
                // ******** DOM WRITE ****************
                (<any>this._el[i].style)[prop] = val;
              }
            }
          }
        }
      }

      // place all transforms on the same property
      if (transforms.length) {
        transforms.push('translateZ(0px)');

        for (var i = 0; i < this._el.length; i++) {
          // ******** DOM WRITE ****************
          (<any>this._el[i].style)[CSS.transform] = transforms.join(' ');
        }
      }
    }

  }

  /**
   * @internal
   * DOM WRITE
   * NO RECURSION
   */
  _setTrans(dur: number, forcedLinearEasing: boolean) {
    // set the TRANSITION properties inline on the element
    if (Object.keys(this._fx).length) {
      var easing = (forcedLinearEasing ? 'linear' : this.getEasing());
      for (var i = 0; i < this._el.length; i++) {
        if (dur > 0) {
          // ******** DOM WRITE ****************
          (<any>this._el[i].style)[CSS.transition] = '';
          (<any>this._el[i].style)[CSS.transitionDuration] = dur + 'ms';

          // each animation can have a different easing
          if (easing) {
            // ******** DOM WRITE ****************
            (<any>this._el[i].style)[CSS.transitionTimingFn] = easing;
          }
        } else {
          (<any>this._el[i].style)[CSS.transition] = 'none';
        }
      }
    }
  }

  /**
   * @internal
   * DOM WRITE
   * NO RECURSION
   */
  _before() {
    // before the animations have started
    if (!this._rv) {
      let ele: HTMLElement;
      for (var i = 0; i < this._el.length; i++) {
        ele = this._el[i];

        // css classes to add before the animation
        for (var j = 0; j < this._bfAdd.length; j++) {
          // ******** DOM WRITE ****************
          ele.classList.add(this._bfAdd[j]);
        }

        // css classes to remove before the animation
        for (var j = 0; j < this._bfRmv.length; j++) {
          // ******** DOM WRITE ****************
          ele.classList.remove(this._bfRmv[j]);
        }

        // inline styles to add before the animation
        for (var prop in this._bfSty) {
          // ******** DOM WRITE ****************
          (<any>ele).style[prop] = this._bfSty[prop];
        }
      }
    }
  }

  /**
   * @internal
   * DOM READ
   * RECURSION
   */
  _beforeReadFn() {
    for (var i = 0; i < this._c.length; i++) {
      // ******** DOM READ ****************
      this._c[i]._beforeReadFn();
    }

    for (var i = 0; i < this._bfReadFns.length; i++) {
      // ******** DOM READ ****************
      this._bfReadFns[i]();
    }
  }

  /**
   * @internal
   * DOM WRITE
   * RECURSION
   */
  _beforeWriteFn() {
    for (var i = 0; i < this._c.length; i++) {
      // ******** DOM WRITE ****************
      this._c[i]._beforeWriteFn();
    }

    for (var i = 0; i < this._bfWriteFns.length; i++) {
      // ******** DOM WRITE ****************
      this._bfWriteFns[i]();
    }
  }

  /**
   * @internal
   * DOM WRITE
   * NO RECURSION
   */
  _after() {
    let ele: HTMLElement;
    for (var i = 0; i < this._el.length; i++) {
      ele = this._el[i];

      // remove the transition duration/easing
      // ******** DOM WRITE ****************
      (<any>ele).style[CSS.transitionDuration] = (<any>ele).style[CSS.transitionTimingFn] = '';

      if (this._rv) {
        // finished in reverse direction

        // css classes that were added before the animation should be removed
        for (var j = 0; j < this._bfAdd.length; j++) {
          // ******** DOM WRITE ****************
          ele.classList.remove(this._bfAdd[j]);
        }

        // css classes that were removed before the animation should be added
        for (var j = 0; j < this._bfRmv.length; j++) {
          // ******** DOM WRITE ****************
          ele.classList.add(this._bfRmv[j]);
        }

        // inline styles that were added before the animation should be removed
        for (var prop in this._bfSty) {
          // ******** DOM WRITE ****************
          (<any>ele).style[prop] = '';
        }

      } else {
        // finished in forward direction

        // css classes to add after the animation
        for (var j = 0; j < this._afAdd.length; j++) {
          // ******** DOM WRITE ****************
          ele.classList.add(this._afAdd[j]);
        }

        // css classes to remove after the animation
        for (var j = 0; j < this._afRmv.length; j++) {
          // ******** DOM WRITE ****************
          ele.classList.remove(this._afRmv[j]);
        }

        // inline styles to add after the animation
        for (var prop in this._afSty) {
          // ******** DOM WRITE ****************
          (<any>ele).style[prop] = this._afSty[prop];
        }
      }
    }

  }

  /**
   * DOM WRITE
   * RECURSION
   */
  progressStart() {
    for (var i = 0; i < this._c.length; i++) {
      // ******** DOM WRITE ****************
      this._c[i].progressStart();
    }

    // ******** DOM WRITE ****************
    this._before();

    // force no duration, linear easing
    // ******** DOM WRITE ****************
    this._setTrans(0, true);
  }

  /**
   * DOM WRITE
   * RECURSION
   */
  progressStep(stepValue: number) {
    let now = Date.now();

    // only update if the last update was more than 16ms ago
    if (now - 16 > this._lastUpd) {
      this._lastUpd = now;

      stepValue = Math.min(1, Math.max(0, stepValue));

      for (var i = 0; i < this._c.length; i++) {
        // ******** DOM WRITE ****************
        this._c[i].progressStep(stepValue);
      }

      if (this._rv) {
        // if the animation is going in reverse then
        // flip the step value: 0 becomes 1, 1 becomes 0
        stepValue = ((stepValue * -1) + 1);
      }

      // ******** DOM WRITE ****************
      this._progress(stepValue);
    }
  }

  /**
   * DOM WRITE
   * RECURSION
   */
  progressEnd(shouldComplete: boolean, currentStepValue: number) {
    console.debug('Animation, progressEnd, shouldComplete', shouldComplete, 'currentStepValue', currentStepValue);

    for (var i = 0; i < this._c.length; i++) {
      // ******** DOM WRITE ****************
      this._c[i].progressEnd(shouldComplete, currentStepValue);
    }

    // set all the animations to their final position
    // ******** DOM WRITE ****************
    this._progress(shouldComplete ? 1 : 0);

    // if it's already at the final position, or close, then it's done
    // otherwise we need to add a transition end event listener
    if (currentStepValue < 0.05 || currentStepValue > 0.95) {
      // the progress was already left off at the point that is finished
      // for example, the left menu was dragged all the way open already
      // ******** DOM WRITE ****************
      this._after();

      this._didFinish(shouldComplete);

    } else {
      // the stepValue was left off at a point when it needs to finish transition still
      // for example, the left menu was opened 75% and needs to finish opening
      // ******** DOM WRITE ****************
      this._asyncEnd(64, shouldComplete);

      // force quick duration, linear easing
      // ******** DOM WRITE ****************
      this._setTrans(64, true);
    }
  }

  /**
   * POSSIBLE DOM READ/WRITE
   */
  onFinish(callback: Function, onceTimeCallback: boolean = false, clearOnFinishCallacks: boolean = false): Animation {
    if (clearOnFinishCallacks) {
      this._fFns.length = this._fOnceFns.length = 0;
    }
    if (onceTimeCallback) {
      this._fOnceFns.push(callback);

    } else {
      this._fFns.push(callback);
    }
    return this;
  }

  /**
   * @internal
   * RECURSION
   */
  _didFinish(hasCompleted: boolean) {
    this.isPlaying = false;
    this.hasCompleted = hasCompleted;

    for (var i = 0; i < this._c.length; i++) {
      this._c[i]._didFinish(hasCompleted);
    }

    for (var i = 0; i < this._fFns.length; i++) {
      this._fFns[i](this);
    }
    for (var i = 0; i < this._fOnceFns.length; i++) {
      this._fOnceFns[i](this);
    }
    this._fOnceFns.length = 0;
  }

  /**
   * NO DOM
   * RECURSION
   */
  reverse(shouldReverse: boolean = true): Animation {
    for (var i = 0; i < this._c.length; i++) {
      this._c[i].reverse(shouldReverse);
    }
    this._rv = shouldReverse;
    return this;
  }

  /**
   * DOM WRITE
   * RECURSION
   */
  destroy() {
    for (var i = 0; i < this._c.length; i++) {
      // ******** DOM WRITE ****************
      this._c[i].destroy();
    }

    this._clearAsync();
    this._reset();
  }

  /**
   * @internal
   * NO DOM
   */
  _transEl(): HTMLElement {
    // get the lowest level element that has an Animation
    var targetEl: HTMLElement;

    for (var i = 0; i < this._c.length; i++) {
      targetEl = this._c[i]._transEl();
      if (targetEl) {
        return targetEl;
      }
    }

    return (this.hasTween && this._hasDur && this._el.length ? this._el[0] : null);
  }


  // ***** STATIC CLASSES *********

  static create(name: string, opts: AnimationOptions = {}): Animation {
    let AnimationClass = AnimationRegistry[name];

    if (!AnimationClass) {
      // couldn't find an animation by the given name
      // fallback to just the base Animation class
      AnimationClass = Animation;
    }
    return new AnimationClass(null, opts);
  }

  static register(name: string, AnimationClass: any) {
    AnimationRegistry[name] = AnimationClass;
  }

}

export interface AnimationOptions {
  animation?: string;
  duration?: number;
  easing?: string;
  direction?: string;
  renderDelay?: number;
  isRTL?: boolean;
  ev?: any;
}

export interface PlayOptions {
  duration?: number;
  stepValue?: number;
}

export interface EffectProperty {
  trans: boolean;
  to?: EffectState;
  from?: EffectState;
}

export interface EffectState {
  val: any;
  num: number;
  unit: string;
}

const TRANSFORMS: any = {
  'translateX': 1, 'translateY': 1, 'translateZ': 1, 'scale': 1, 'scaleX': 1, 'scaleY': 1, 'scaleZ': 1, 'rotate': 1, 'rotateX': 1, 'rotateY': 1, 'rotateZ': 1, 'skewX': 1, 'skewY': 1, 'perspective': 1
};

const AnimationRegistry: {[key: string]: any} = {};
const CSS_VALUE_REGEX = /(^-?\d*\.?\d*)(.*)/;
const ANIMATION_DURATION_MIN = 32;
const TRANSITION_END_FALLBACK_PADDING_MS = 400;
