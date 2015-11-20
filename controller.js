global.ensembleNamespace = {};
var fs = require('fs');
var path = require('path');
var utils = require('./utils.js');



module.exports = {
  // createEnsemble: function(fileNameIdentifier, inputFolderLocation, outputFolderLocation) {
  createEnsemble: function(args) {
    // we're actually going to be running through ensembler twice: 
      // once for the validation data set
      // once for the actual predictions data set
    // if the user doesn't pass in a value, we'll assume they just want predictions
    if( args.validationRound === undefined ) {
      args.validationRound = false;
    }
    var fileNameIdentifier = args.fileNameIdentifier;
    global.ensembleNamespace.fileNameIdentifier = args.fileNameIdentifier;
    // // I think for the public interface, it is easiest to understand having the user pass in two folder paths. However, I think the code is easiest to read when we access it the following way:
    // var locations = {
    //   inputFolder: inputFolderLocation,
    //   outputFolder: outputFolderLocation
    // };

    // generateSummary reads in the prediction files from each classifier, and loads them into an in-memory object that matches them all up by rowID. 
    // it takes a callback that will be invoked after reading all the files and loading in all the data. 
    utils.generateSummary( args, function() {

      // FUTURE: 
        // 1. Test all combinations of number of classifiers among the ones we've trained
          // 2. for each combination of classifiers, run every single one of our ensembling methods
          // 3. pick the [combination of classifiers, ensembling method] pair that has the lowest error rate across the data set

      // as outlined above, at some point in the future, bestClassifierList will be a calculated value. 
      // for now, just use all the classifiers whose data we have read in. 
      var bestClassifierList = global.ensembleNamespace.summarizedAlgorithmNames;
      // var bestClassifierList = [];
      // var scoresObjs = global.ensembleNamespace.scores;

      // // our bestScore is going to be the first one. within that row, we care about the validation score, at position 0.
      // var bestScore = scoresObjs[0].scores[0];
      // for( var i = 0; i < scoresObjs.length; i++ ) {
      //   if( i < 5 || scoresObjs[i].scores[0] > .98 * bestScore ) {
      //     bestClassifierList.push(scoresObjs[i].scores[0]);
      //   }
      // }

      // calculateAggregatedPredictions uses the best combination of classifiers and ensembling method to create our final prediction. 
      // until we are ready for our version 3.0 release, we will simply pass it all of our classifiers, with the ensemble method of bagging them together. 
      var results = utils.calculateAggregatedPredictions(bestClassifierList, 'average');
      
      utils.writeToFile(fileNameIdentifier, args, results, function() {
        console.log('We have just written the final predictions to a file called "' + fileNameIdentifier + 'PredictedResults.csv" that is saved at:\n',args.outputFolder + '/' + fileNameIdentifier + 'PredictedResults.csv');
        console.log('Thanks for letting us help you on your machine learning journey! Hopefully this freed up more of your time to do the fun parts of ML. Pull Requests to make this even better are always welcome!');
        // this is designed to work with ppComplete to ensure we have a proper shutdown of any stray childProcesses that might be going rogue on us. 
        process.emit('killAll');
      });
      // generate the set that is the combination of all the algos we've trained so far
      // iterate through each row
        // for each item in that combination set, run through our whole ensembling logic, calculating the error rate for that row for that particular ensembling method
      // use the best set and ensembling method to calculate scores for each item
      // write to a file. 
    });
  },

  // this method is primarily designed to work with ppComplete. It is simply a way of determining when we will invoke makeEnsemble. 
  // this will likely be refactored back into ppComplete at some point. 
  // startListeners: function(numOfAlgosToWaitOn, fileNameIdentifier, inputFolderLocation, outputFolderLocation) {
  startListeners: function(numOfAlgosToWaitOn, args) {

    function checkIfFinished() {
      if(finishedAlgos === numOfAlgosToWaitOn - 1) {
        // tell the neural net it's time to turn off the light, stop reading, and go to bed. 
        // the neural net is going to train itself until all the other processes have finished, that way it is as accurate as possible
        process.emit('stopTraining');
      } else if( finishedAlgos === numOfAlgosToWaitOn ) {
        module.exports.createEnsemble(args);
        // module.exports.createEnsemble(fileNameIdentifier, inputFolderLocation, outputFolderLocation);
      }
    }

    var finishedAlgos = 0;

    process.on('algoFinishedPredicting', function() {
      finishedAlgos++;
      console.log('numOfAlgosToWaitOn:', numOfAlgosToWaitOn, 'finishedAlgos:', finishedAlgos);
      checkIfFinished();
    });

    // if an algorithm has not proven effectice for this data set after a certain number of tries, we are not going to train any more of them.
    // but, since we said at the start to expect a certain number of algorithms to be trained, we must still emit an event to notify ensembler that we are skipping over an algorithm
    process.on('algoSkippedTraining', function() {
      finishedAlgos++;
      checkIfFinished();
    });

  }


}
