import DeviceDetector from "https://cdn.skypack.dev/device-detector-js@2.2.10";
// Usage: testSupport({client?: string, os?: string}[])
// Client and os are regular expressions.
// See: https://cdn.jsdelivr.net/npm/device-detector-js@2.2.10/README.md for
// legal values for client and os
testSupport([
    { client: 'Chrome' },
]);
function testSupport(supportedDevices) {
    const deviceDetector = new DeviceDetector();
    const detectedDevice = deviceDetector.parse(navigator.userAgent);
    let isSupported = false;
    for (const device of supportedDevices) {
        if (device.client !== undefined) {
            const re = new RegExp(`^${device.client}$`);
            if (!re.test(detectedDevice.client.name)) {
                continue;
            }
        }
        if (device.os !== undefined) {
            const re = new RegExp(`^${device.os}$`);
            if (!re.test(detectedDevice.os.name)) {
                continue;
            }
        }
        isSupported = true;
        break;
    }
    if (!isSupported) {
        alert(`This demo, running on ${detectedDevice.client.name}/${detectedDevice.os.name}, ` +
            `is not well supported at this time, continue at your own risk.`);
    }
}
const controls = window;
const drawingUtils = window;
const mpObjectron = window;
const config = { locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/objectron@0.3.1627447724/${file}`;
    } };
const examples = {
    images: [
        { name: 'Camera image', src: 'https://assets.codepen.io/5409376/camera.jpg' },
        { name: 'Chair image', src: 'https://assets.codepen.io/5409376/chair.jpg' },
        { name: 'Cup image', src: 'https://assets.codepen.io/5409376/cup.jpg' },
        { name: 'Shoe image', src: 'https://assets.codepen.io/5409376/shoe.jpg' },
    ],
    videos: [
        {
            name: 'Camera video',
            src: 'https://assets.codepen.io/5409376/camera_3_8.mp4'
        },
        {
            name: 'Chair video',
            src: 'https://assets.codepen.io/5409376/chair_10_1.mp4'
        },
        { name: 'Cup video', src: 'https://assets.codepen.io/5409376/cup_43_42.mp4' },
        {
            name: 'Shoe video',
            src: 'https://assets.codepen.io/5409376/shoe_1063642984-sd-trim-short.mov'
        }
    ],
};
// Our input frames will come from here.
const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const controlsElement = document.getElementsByClassName('control-panel')[0];
const canvasCtx = canvasElement.getContext('2d');
// We'll add this to our control panel later, but we'll save it here so we can
// call tick() each time the graph runs.
const fpsControl = new controls.FPS();
// Optimization: Turn off animated spinner after its hiding animation is done.
const spinner = document.querySelector('.loading');
spinner.ontransitionend = () => {
    spinner.style.display = 'none';
};
function onResults(results) {
    // Hide the spinner.
    document.body.classList.add('loaded');
    // Update the frame rate.
    fpsControl.tick();
    // Draw the overlays.
    canvasCtx.save();
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    if (!!results.objectDetections) {
        for (const detectedObject of results.objectDetections) {
            // Reformat keypoint information as landmarks, for easy drawing.
            const landmarks = detectedObject.keypoints.map(x => x.point2d);
            // Draw bounding box.
            drawingUtils.drawConnectors(canvasCtx, landmarks, mpObjectron.BOX_CONNECTIONS, { color: '#FF0000' });
            // Draw Axes
            drawAxes(canvasCtx, landmarks, {
                x: '#00FF00',
                y: '#FF0000',
                z: '#0000FF',
            });
            // Draw centroid.
            drawingUtils.drawLandmarks(canvasCtx, [landmarks[0]], { color: '#FFFFFF' });
        }
    }
    canvasCtx.restore();
}
const objectron = new mpObjectron.Objectron(config);
objectron.onResults(onResults);
// Present a control panel through which the user can manipulate the solution
// options.
new controls
    .ControlPanel(controlsElement, {
    selfieMode: false,
    modelName: 'Shoe',
    maxNumObjects: 5,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.99,
})
    .add([
    new controls.StaticText({ title: 'MediaPipe Objectron' }),
    fpsControl,
    new controls.SourcePicker({
        onSourceChanged: (name, type) => {
            objectron.setOptions({ staticImageMode: type !== 'image' });
            objectron.reset();
        },
        onFrame: async (input, size) => {
            const aspect = size.height / size.width;
            let width, height;
            if (window.innerWidth > window.innerHeight) {
                height = window.innerHeight;
                width = height / aspect;
            }
            else {
                width = window.innerWidth;
                height = width * aspect;
            }
            canvasElement.width = width;
            canvasElement.height = height;
            await objectron.send({ image: input });
        },
        examples,
    }),
    new controls.Toggle({ title: 'Selfie Mode', field: 'selfieMode' }),
    new controls.DropDownControl({
        title: 'Model',
        field: 'modelName',
        options: [
            {
                name: 'Shoe',
                value: 'Shoe',
            },
            {
                name: 'Camera',
                value: 'Camera',
            },
            {
                name: 'Chair',
                value: 'Chair',
            },
            {
                name: 'Cup',
                value: 'Cup',
            },
        ]
    }),
    new controls.Slider({
        title: 'Max Num Objects',
        field: 'maxNumObjects',
        range: [1, 10],
        step: 1,
    }),
    new controls.Slider({
        title: 'Min Detection Confidence',
        field: 'minDetectionConfidence',
        range: [0, 1],
        step: 0.01
    }),
    new controls.Slider({
        title: 'Min Tracking Confidence',
        field: 'minTrackingConfidence',
        range: [0, 1],
        step: 0.01
    }),
])
    .on(x => {
    const options = x;
    videoElement.classList.toggle('selfie', options.selfieMode);
    objectron.setOptions(options);
});
function drawAxes(canvasCtx, landmarks, color) {
    const { BACK_BOTTOM_RIGHT, BACK_TOP_LEFT, BACK_TOP_RIGHT, FRONT_BOTTOM_LEFT, FRONT_BOTTOM_RIGHT, FRONT_TOP_RIGHT, FRONT_TOP_LEFT, CENTER } = mpObjectron.BOX_KEYPOINTS;
    const xMidPoint = lineIntersection([landmarks[BACK_BOTTOM_RIGHT], landmarks[FRONT_TOP_RIGHT]], [landmarks[BACK_TOP_RIGHT], landmarks[FRONT_BOTTOM_RIGHT]]);
    const yMidPoint = lineIntersection([landmarks[BACK_TOP_LEFT], landmarks[FRONT_TOP_RIGHT]], [landmarks[FRONT_TOP_LEFT], landmarks[BACK_TOP_RIGHT]]);
    const zMidPoint = lineIntersection([landmarks[FRONT_TOP_RIGHT], landmarks[FRONT_BOTTOM_LEFT]], [landmarks[FRONT_TOP_LEFT], landmarks[FRONT_BOTTOM_RIGHT]]);
    const LINE_WIDTH = 8;
    const TRIANGLE_BASE = 2 * LINE_WIDTH;
    drawingUtils.drawConnectors(canvasCtx, [landmarks[CENTER], xMidPoint], [[0, 1]], { color: color.x, lineWidth: LINE_WIDTH });
    drawingUtils.drawConnectors(canvasCtx, [landmarks[CENTER], yMidPoint], [[0, 1]], { color: color.y, lineWidth: LINE_WIDTH });
    drawingUtils.drawConnectors(canvasCtx, [landmarks[CENTER], zMidPoint], [[0, 1]], { color: color.z, lineWidth: LINE_WIDTH });
    drawTriangle(canvasCtx, xMidPoint, TRIANGLE_BASE, TRIANGLE_BASE, color.x, arctan360(xMidPoint.x - landmarks[CENTER].x, xMidPoint.y - landmarks[CENTER].y) +
        Math.PI / 2);
    drawTriangle(canvasCtx, yMidPoint, TRIANGLE_BASE, TRIANGLE_BASE, color.y, arctan360(yMidPoint.x - landmarks[CENTER].x, yMidPoint.y - landmarks[CENTER].y) +
        Math.PI / 2);
    drawTriangle(canvasCtx, zMidPoint, TRIANGLE_BASE, TRIANGLE_BASE, color.z, arctan360(zMidPoint.x - landmarks[CENTER].x, zMidPoint.y - landmarks[CENTER].y) +
        Math.PI / 2);
}
function lineIntersection(a, b) {
    const yDiffB = b[0].y - b[1].y;
    const xDiffB = b[0].x - b[1].x;
    const top = (a[0].x - b[0].x) * yDiffB - (a[0].y - b[0].y) * xDiffB;
    const bot = (a[0].x - a[1].x) * yDiffB - (a[0].y - a[1].y) * xDiffB;
    const t = top / bot;
    return {
        x: a[0].x + t * (a[1].x - a[0].x),
        y: a[0].y + t * (a[1].y - a[0].y),
        depth: 0,
    };
}
function drawTriangle(ctx, point, height, base, color, rotation = 0) {
    const canvas = ctx.canvas;
    const realX = canvas.width * point.x;
    const realY = canvas.height * point.y;
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.translate(realX, realY);
    ctx.rotate(rotation);
    ctx.moveTo(base / 2, 0);
    ctx.lineTo(0, -height);
    ctx.lineTo(-base / 2, 0);
    ctx.lineTo(base / 2, 0);
    ctx.translate(-realX, -realY);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}
function arctan360(x, y) {
    if (x === 0) {
        return y >= 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    const angle = Math.atan(y / x);
    if (x > 0) {
        return angle;
    }
    return y >= 0 ? (angle + Math.PI) : angle - Math.PI;
}
