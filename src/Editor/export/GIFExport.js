class GIFExport {
  /**
   * Create an animated GIF from a Wick project.
   * @param {Wick.Project} project - the Wick project to create a GIF out of.
   * @param {function} done - Callback that passes the GIF file as a blob when the GIF is done rendering.
   */
  static createAnimatedGIFFromProject (args) {
    let { project, onProgress, onFinish } = args;

    const combiningProgress = 40;
    const renderingProgress = 70;
    const finishedProgress = 99; 

    onProgress("Creating Gif", 10);

    let width = args.width || project.width;
    let height = args.height || project.height;

    // Initialize GIF.js
    let gif = new window.GIF({
      workers: 2,
      quality: 10,
      width: width,
      height: height,
      workerScript: "corelibs/gif/gif.worker.js",
    });

    gif.on('finished', (gif) => {
      onProgress('Saving GIF file (this may take a while)...', finishedProgress);
      onFinish(gif);
    });

    gif.on('progress', (progress) => {
      let prog = 100*progress; 
      onProgress(`Rendering GIF: ${prog.toFixed(2)}%`, renderingProgress + progress*(finishedProgress-renderingProgress)); 
    })

    let combineImageSequence = images => {
      images.forEach(image => {
        // GIF has no alpha channel here - gif.js composites every frame onto black - so a
        // transparent project is flattened onto its background color first rather than
        // silently turning black.
        let frame = project.transparentBackground
          ? GIFExport._flattenOntoMatte(image, project.backgroundColor.hex, width, height)
          : image;

        // Add frame to gif.
        gif.addFrame(frame, {delay: 1000/project.framerate});
      });
      onProgress('Rendering GIF', renderingProgress);
      gif.render(); // Finalize gif render.
    }

    let updateProgress = (completed, maxFrames) => {
      // Change visual of the loading bar
      let message = "Rendered " + completed + "/" + maxFrames + " frames";
      let percentage = (combiningProgress * (completed/maxFrames));
      onProgress(message, percentage);
    }

    // Get frame images from project, add to GIF.js
    project.generateImageSequence({
      width: width,
      height: height,
      onFinish: combineImageSequence,
      onProgress: updateProgress,
    });
  }

  /**
   * Draw a rendered frame onto an opaque matte color.
   * @returns {HTMLCanvasElement}
   */
  static _flattenOntoMatte (image, matteColor, width, height) {
    let canvas = window.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    let ctx = canvas.getContext('2d');
    ctx.fillStyle = matteColor;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    return canvas;
  }
}

export default GIFExport;
