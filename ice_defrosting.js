"use strict";
(function () {
    "use strict";
    // A custom shader that simulates ice surface refraction.
    const iceRefractionShader = {
        uniforms: {
            color: { value: null },
            tDiffuse: { value: null },
            tIceColorMap: { value: null },
            tIceAlphaMap: { value: null },
            tAlphaMap: { value: null },
            tDudv: { value: null },
            textureMatrix: { value: null }
        },
        vertexShader: `
    uniform mat4 textureMatrix;
    varying vec2 vUv;
    varying vec4 vUvRefraction;

    void main() {
      vUv = uv;
      vUvRefraction = textureMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
        fragmentShader: `
    uniform float time;
    uniform sampler2D tDiffuse;
    uniform sampler2D tIceColorMap;
    uniform sampler2D tIceAlphaMap;
    uniform sampler2D tAlphaMap;
    uniform sampler2D tDudv;

    varying vec2 vUv;
    varying vec4 vUvRefraction;

    void main() {
      float distortionStrength = 0.5;

      vec2 distortedUv = texture2D(tDudv, vUv.xy).rg * distortionStrength;
      distortedUv = vUv.xy + vec2(distortedUv.x, distortedUv.y);
      vec2 distortion = (texture2D(tDudv, distortedUv).rg * 2.0 - 1.0) * distortionStrength;

      vec4 uv = vec4(vUvRefraction);
      uv.xy += distortion;

      vec4 base = texture2DProj(tDiffuse, uv);
      vec4 iceColor = texture2D(tIceColorMap, vUv.xy);
      vec4 iceAlpha = texture2D(tIceAlphaMap, vUv.xy);
      vec4 alpha = texture2D(tAlphaMap, vUv.xy);

      gl_FragColor = vec4(mix(base.rgb, iceColor.rgb, iceAlpha.r), alpha.r);
    }
  `
    };
    class IceDefrostingEffectRenderer {
        constructor(config) {
            // Remember the config.
            this.config = config;
            // Create a scene, a renderer and a camera.
            this.scene = new THREE.Scene();
            this.renderer = new THREE.WebGLRenderer({
                canvas: config.canvasElement,
                antialias: true
            });
            this.renderer.setSize(config.viewportWidth, config.viewportHeight);
            this.camera = new THREE.PerspectiveCamera(config.verticalFov, config.viewportWidth / config.viewportHeight, config.near, config.far);
            // Create two buffer for frost layer mask accumulation.
            this.currentAccumulationMaskBuffer = new THREE.WebGLRenderTarget(config.viewportWidth, config.viewportHeight, { minFilter: THREE.LinearFilter, magFilter: THREE.NearestFilter });
            this.previousAccumulationMaskBuffer = new THREE.WebGLRenderTarget(config.viewportWidth, config.viewportHeight, { minFilter: THREE.LinearFilter, magFilter: THREE.NearestFilter });
            // Optimization: create commonly used plane geometries.
            this.viewportPlane = new THREE.PlaneBufferGeometry(config.viewportWidth, config.viewportHeight);
            this.unitSizePlane = new THREE.PlaneBufferGeometry(1, 1);
            // Start loading assets need for this effect.
            this.numAssetsToLoad = 6;
            const root = this;
            const onTextureLoadFn = function (_) {
                --root.numAssetsToLoad;
            };
            const texturePathPrefix = "https://assets.codepen.io/5409376";
            this.frostDiffuseTexture = new THREE.TextureLoader().load(texturePathPrefix + "/frost_diffuse.jpg", onTextureLoadFn);
            this.frostDudvTexture = new THREE.TextureLoader().load(texturePathPrefix + "/frost_dudv.jpg", onTextureLoadFn);
            this.frostDudvTexture.wrapS = this.frostDudvTexture.wrapT =
                THREE.RepeatWrapping;
            this.frostTransparencyTexture = new THREE.TextureLoader().load(texturePathPrefix + "/frost_transparency.jpg", onTextureLoadFn);
            this.handHintTexture = new THREE.TextureLoader().load(texturePathPrefix + "/hand_hint.png", onTextureLoadFn);
            this.handMaskTexture = new THREE.TextureLoader().load(texturePathPrefix + "/hand_mask.png", onTextureLoadFn);
            this.onboardingTextTexture = new THREE.TextureLoader().load(texturePathPrefix + "/onboarding_text.png", onTextureLoadFn);
            // Define a safe upper bound for the number of layer-planes. Used to
            // calculate Z coordinates based on the plane order.
            this.numLayersUpperBound = 16;
        }
        isReadyToRender() {
            return this.numAssetsToLoad <= 0;
        }
        render(cameraFrame, firstHandCircle) {
            if (!this.isReadyToRender()) {
                return;
            }
            // Ignore the hand tracking result in the beginning to allow other animated
            // elements to progress.
            this.ignoreHandsAnimationClock =
                this.ignoreHandsAnimationClock || new THREE.Clock();
            if (this.ignoreHandsAnimationClock.getElapsedTime() <
                this.config.ignoreHandsIntroLength) {
                firstHandCircle = null;
            }
            // Update (render) the occlusion mask for the frost object.
            this.renderFrostOcclusionMaskPass(firstHandCircle);
            // Render the final effect.
            this.renderFinalPass(cameraFrame, firstHandCircle);
            // Swap the current and the previous accumulation mask buffers.
            [
                this.currentAccumulationMaskBuffer,
                this.previousAccumulationMaskBuffer
            ] = [
                this.previousAccumulationMaskBuffer,
                this.currentAccumulationMaskBuffer
            ];
        }
        renderFrostOcclusionMaskPass(firstHandCircle) {
            // Create planes for the frost layer mask accumulation logic.
            const previousAccumulationMaskPlane = this.placeInPerspectiveFrustum(this.createPreviousAccumulationMaskPlane(), this.calculateDepthFromOrderIdx(-1));
            this.scene.add(previousAccumulationMaskPlane);
            const deltaAccumulationMaskPlane = this.placeInPerspectiveFrustum(this.createDeltaAccumulationMaskPlane(firstHandCircle != null), this.calculateDepthFromOrderIdx(-2));
            if (deltaAccumulationMaskPlane) {
                this.scene.add(deltaAccumulationMaskPlane);
            }
            // Create the hand mask object to clear the accumulated mask.
            const handMaskObj = this.placeInPerspectiveFrustum(this.createHandMaskObj(firstHandCircle), this.calculateDepthFromOrderIdx(-3));
            if (handMaskObj) {
                this.scene.add(handMaskObj);
            }
            this.renderer.setRenderTarget(this.currentAccumulationMaskBuffer);
            this.renderer.render(this.scene, this.camera);
            this.renderer.setRenderTarget(null);
            this.scene.clear();
        }
        renderFinalPass(cameraFrame, firstHandCircle) {
            // Create the camera frame plane.
            const cameraFramePlane = this.placeInPerspectiveFrustum(this.createCameraFramePlane(cameraFrame), this.calculateDepthFromOrderIdx(-1));
            this.scene.add(cameraFramePlane);
            // Create the ice frost plane.
            const frostPlane = this.placeInPerspectiveFrustum(this.createFrostPlane(), this.calculateDepthFromOrderIdx(-2));
            this.scene.add(frostPlane);
            // Create the onboarding text plane.
            const onboardingTextPlane = this.placeInPerspectiveFrustum(this.createOnboardingTextPlane(firstHandCircle != null), this.calculateDepthFromOrderIdx(-4));
            this.scene.add(onboardingTextPlane);
            // Create the hand hint object to show user which hand is tracked.
            const handHintObj = this.placeInPerspectiveFrustum(this.createHandHintObj(firstHandCircle), this.calculateDepthFromOrderIdx(-3));
            if (handHintObj) {
                this.scene.add(handHintObj);
            }
            this.renderer.render(this.scene, this.camera);
            this.scene.clear();
        }
        createCameraFramePlane(image) {
            return new THREE.Mesh(this.viewportPlane, new THREE.MeshBasicMaterial({
                map: new THREE.CanvasTexture(image)
            }));
        }
        createFrostPlane() {
            const frostPlane = new THREE.Refractor(this.viewportPlane, {
                textureWidth: this.config.viewportWidth,
                textureHeight: this.config.viewportHeight,
                shader: iceRefractionShader
            });
            frostPlane.material.uniforms["tDudv"].value = this.frostDudvTexture;
            frostPlane.material.uniforms["tIceColorMap"].value = this.frostDiffuseTexture;
            frostPlane.material.uniforms["tIceAlphaMap"].value = this.frostTransparencyTexture;
            frostPlane.material.uniforms["tAlphaMap"].value = this.currentAccumulationMaskBuffer.texture;
            return frostPlane;
        }
        createOnboardingTextPlane(hasFirstHand) {
            const config = this.config.onboardingText;
            const opacityAnimationIntroLength = config.opacityAnimationIntroLength;
            const opacityAnimationLoopLength = config.opacityAnimationLoopLength;
            this.onboardingTextAnimationClock =
                this.onboardingTextAnimationClock || new THREE.Clock(false);
            let opacity = null;
            if (hasFirstHand) {
                this.onboardingTextAnimationClock.stop();
                opacity = 0;
            }
            else {
                if (!this.onboardingTextAnimationClock.running) {
                    this.onboardingTextAnimationClock.start();
                }
                const elapsedTime = this.onboardingTextAnimationClock.getElapsedTime();
                if (elapsedTime < opacityAnimationIntroLength) {
                    opacity = 0;
                }
                else {
                    const loopTime = (elapsedTime - opacityAnimationIntroLength) %
                        opacityAnimationLoopLength;
                    opacity = (2 * loopTime) / opacityAnimationLoopLength;
                    if (opacity > 1) {
                        opacity = 2 - opacity;
                    }
                }
            }
            return new THREE.Mesh(this.viewportPlane, new THREE.MeshBasicMaterial({
                map: this.onboardingTextTexture,
                opacity,
                transparent: true
            }));
        }
        createPreviousAccumulationMaskPlane() {
            return new THREE.Mesh(this.viewportPlane, new THREE.MeshBasicMaterial({
                map: this.previousAccumulationMaskBuffer.texture,
                blending: THREE.AdditiveBlending
            }));
        }
        createDeltaAccumulationMaskPlane(hasFirstHand) {
            const config = this.config.maskAccumulation;
            const animationIntroLength = config.animationIntroLength;
            const animationGainLength = config.animationGainLength;
            const skipIntroDuringFirstCycle = config.skipIntroDuringFirstCycle;
            this.maskAccumulationAnimationClock =
                this.maskAccumulationAnimationClock || new THREE.Clock(false);
            this.maskAccumulationAnimationNumCycles =
                this.maskAccumulationAnimationNumCycles || 0;
            if (hasFirstHand) {
                this.maskAccumulationAnimationClock.stop();
                return null;
            }
            if (!this.maskAccumulationAnimationClock.running) {
                this.maskAccumulationAnimationClock.start();
                ++this.maskAccumulationAnimationNumCycles;
            }
            const conditionedAnimationIntroLength = this.maskAccumulationAnimationNumCycles == 1 &&
                skipIntroDuringFirstCycle
                ? 0
                : animationIntroLength;
            const delta = this.maskAccumulationAnimationClock.getDelta();
            const elapsedTime = this.maskAccumulationAnimationClock.elapsedTime;
            if (elapsedTime < conditionedAnimationIntroLength) {
                return null;
            }
            const maskAccumulationDelta = Math.min(delta, elapsedTime - conditionedAnimationIntroLength) /
                animationGainLength;
            return new THREE.Mesh(this.viewportPlane, new THREE.MeshBasicMaterial({
                color: new THREE.Color(maskAccumulationDelta, maskAccumulationDelta, maskAccumulationDelta),
                blending: THREE.AdditiveBlending,
                transparent: true
            }));
        }
        createHandMaskObj(handCircle) {
            if (!handCircle) {
                return null;
            }
            const planeSize = this.config.handMaskRadiusFactor * handCircle.radius;
            const handMaskObj = new THREE.Mesh(this.unitSizePlane, new THREE.MeshBasicMaterial({
                map: this.handMaskTexture,
                transparent: true
            }));
            handMaskObj.scale.x = planeSize;
            handMaskObj.scale.y = planeSize;
            handMaskObj.position.x = handCircle.centerX;
            handMaskObj.position.y = handCircle.centerY;
            return handMaskObj;
        }
        createHandHintObj(handCircle) {
            if (!handCircle) {
                return null;
            }
            const planeSize = this.config.handHintRadiusFactor * handCircle.radius;
            const handHintObj = new THREE.Mesh(this.unitSizePlane, new THREE.MeshBasicMaterial({
                map: this.handHintTexture,
                transparent: true
            }));
            handHintObj.scale.x = planeSize;
            handHintObj.scale.y = planeSize;
            handHintObj.position.x = handCircle.centerX;
            handHintObj.position.y = handCircle.centerY;
            return handHintObj;
        }
        calculateDepthFromOrderIdx(orderIdx) {
            if (orderIdx >= this.numLayersUpperBound ||
                orderIdx < -this.numLayersUpperBound) {
                throw new Error(`orderIdx is out of range! orderIdx = ${orderIdx}, numLayersUpperBound = ${this.numLayersUpperBound}`);
            }
            if (orderIdx < 0) {
                orderIdx += this.numLayersUpperBound;
            }
            const segmentLength = (this.config.far - this.config.near) / (this.numLayersUpperBound + 1);
            return this.config.near + segmentLength * (orderIdx + 1);
        }
        placeInPerspectiveFrustum(obj, depth) {
            if (!obj) {
                return obj;
            }
            const heightAtDepth = 2 * depth * Math.tan((this.config.verticalFov * Math.PI) / 360);
            const scaleFactor = heightAtDepth / this.config.viewportHeight;
            obj.scale.x *= scaleFactor;
            obj.scale.y *= scaleFactor;
            obj.scale.z *= scaleFactor;
            obj.position.x *= scaleFactor;
            obj.position.y *= scaleFactor;
            obj.position.z = obj.position.z * scaleFactor - depth;
            return obj;
        }
    }
    class HandLandmarkProcessor {
        constructor(config) {
            // Remember the config.
            this.config = config;
            // Set all state-related members to default values.
            this.filteredHandCircle = null;
            this.lastHandCircle = null;
            this.lastHandCircleLifetime = 0;
            this.lastHandCirclePresence = 0;
        }
        // Returns a hand circle data for the first tracked hand.
        process(multiHandLandmarks) {
            return this.filterHandCircleTemporally(this.extractFirstHandCircle(multiHandLandmarks));
        }
        extractFirstHandCircle(multiHandLandmarks) {
            if (!multiHandLandmarks || multiHandLandmarks.length < 1) {
                return null;
            }
            const handLandmarks = multiHandLandmarks[0];
            const viewportLandmarkX = (i) => {
                return (handLandmarks[i].x - 0.5) * this.config.viewportWidth;
            };
            const viewportLandmarkY = (i) => {
                return (0.5 - handLandmarks[i].y) * this.config.viewportHeight;
            };
            let centerX = 0;
            let centerY = 0;
            for (let i = 0; i < handLandmarks.length; ++i) {
                centerX += (viewportLandmarkX(i) - centerX) / (i + 1);
                centerY += (viewportLandmarkY(i) - centerY) / (i + 1);
            }
            let radius = 0;
            for (let i = 0; i < handLandmarks.length; ++i) {
                const dx = viewportLandmarkX(i) - centerX;
                const dy = viewportLandmarkY(i) - centerY;
                radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy));
            }
            return { centerX, centerY, radius };
        }
        filterHandCircleTemporally(handCircle) {
            const mix = (a, b) => {
                return ((1 - this.config.lowPassAlpha) * a + this.config.lowPassAlpha * b);
            };
            const mixHandCircle = (a, b) => {
                return {
                    centerX: mix(a.centerX, b.centerX),
                    centerY: mix(a.centerY, b.centerY),
                    radius: mix(a.radius, b.radius)
                };
            };
            if (handCircle) {
                this.lastHandCircle = handCircle;
                this.lastHandCircleLifetime = 0;
                ++this.lastHandCirclePresence;
            }
            else {
                ++this.lastHandCircleLifetime;
                if (this.lastHandCircleLifetime >=
                    this.config.handDetectionLifetimeThreshold) {
                    this.lastHandCircle = null;
                    this.lastHandCircleLifetime = 0;
                    this.lastHandCirclePresence = 0;
                }
            }
            if (this.filteredHandCircle && this.lastHandCircle) {
                this.filteredHandCircle = mixHandCircle(this.filteredHandCircle, this.lastHandCircle);
            }
            else if (this.lastHandCircle) {
                this.filteredHandCircle = this.lastHandCircle;
            }
            else {
                this.filteredHandCircle = null;
            }
            if (this.lastHandCirclePresence >=
                this.config.handDetectionPresenceThreshold) {
                return this.filteredHandCircle;
            }
            else {
                return null;
            }
        }
    }
    function main() {
        // Our input frames will come from here.
        const videoElement = document.getElementsByClassName("input_video")[0];
        const canvasElement = document.getElementsByClassName("output_canvas")[0];
        // Optimization: Turn off animated spinner after its hiding animation is done.
        const spinner = document.querySelector(".loading");
        spinner.ontransitionend = () => {
            spinner.style.display = "none";
        };
        // Define demo config.
        const iceDefrostingEffectConfig = {
            canvasElement: canvasElement,
            viewportWidth: 1280,
            viewportHeight: 720,
            verticalFov: 45,
            near: 1,
            far: 100,
            handMaskRadiusFactor: 2.5,
            handHintRadiusFactor: 2,
            // Animation lengths are in seconds.
            ignoreHandsIntroLength: 2,
            maskAccumulation: {
                animationIntroLength: 0.75,
                animationGainLength: 3,
                skipIntroDuringFirstCycle: true
            },
            onboardingText: {
                opacityAnimationIntroLength: 1,
                opacityAnimationLoopLength: 2
            }
        };
        const handLandmarkProcessorConfig = {
            viewportWidth: iceDefrostingEffectConfig.viewportWidth,
            viewportHeight: iceDefrostingEffectConfig.viewportHeight,
            lowPassAlpha: 0.8,
            handDetectionLifetimeThreshold: 3,
            handDetectionPresenceThreshold: 3
        };
        const handTrackerConfig = {
            selfieMode: true,
            maxHands: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.9
        };
        // Update the camera video element to reflect the selfie mode option.
        videoElement.classList.toggle("selfie", handTrackerConfig.selfieMode);
        // Create an ice defrosting demo renderer.
        const iceDefrostingEffectRenderer = new IceDefrostingEffectRenderer(iceDefrostingEffectConfig);
        // Create a hand landmark processor.
        const handLandmarkProcessor = new HandLandmarkProcessor(handLandmarkProcessorConfig);
        // Create a hand tracker.
        const handTracker = new Hands({
            locateFile: (x) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.1.1606863095/${x}`;
            }
        });
        handTracker.setOptions(handTrackerConfig);
        handTracker.onResults((results) => {
            if (!iceDefrostingEffectRenderer.isReadyToRender()) {
                return;
            }
            // Hide the spinner.
            document.body.classList.add("loaded");
            // Process landmarks & render the effect.
            iceDefrostingEffectRenderer.render(results.image, handLandmarkProcessor.process(results.multiHandLandmarks));
        });
        // Instantiate a camera. We'll feed each frame we receive into the solution.
        const cameraMp = new Camera(videoElement, {
            onFrame: async () => {
                await handTracker.send({ image: videoElement });
            },
            width: iceDefrostingEffectConfig.viewportWidth,
            height: iceDefrostingEffectConfig.viewportHeight
        });
        cameraMp.start();
    }
    main();
})();
