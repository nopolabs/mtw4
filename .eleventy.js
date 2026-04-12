module.exports = function(eleventyConfig) {
  // Pass images through to _site without processing
  eleventyConfig.addPassthroughCopy("src/images");
  eleventyConfig.addPassthroughCopy("src/styles.css");
  eleventyConfig.addPassthroughCopy("src/posts/images");
  eleventyConfig.addPassthroughCopy("src/assets");

  // Date filters for posts
  eleventyConfig.addFilter("readableDate", (date) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric", timeZone: "UTC"
    });
  });

  eleventyConfig.addFilter("isoDate", (date) => {
    return new Date(date).toISOString().split("T")[0];
  });

  return {
    dir: {
      input: "src",
      output: "_site"
    }
  };
};
