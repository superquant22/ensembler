var fs = require('fs');
var fse = require('fs-extra');
var path = require('path');
var byline = require('byline');
// TODO: rename summary to predictionsSummary
var Baby = require('babyparse');
var summary = {};
var ensembleMethods = require('./ensembleMethods.js');
var fastCSV = require('fast-csv');
var pythonUtils = require('./pythonUtils.js');
var math = require('mathjs');

global.ensembleNamespace.summarizedAlgorithmNames = [];
global.ensembleNamespace.predictionsMatrix = [];
global.ensembleNamespace.dataMatrix = [];

module.exports = {

  findFiles: function(args, findFilesCallback) {
    var fileNameIdentifier = args.fileNameIdentifier;
    global.ensembleNamespace.scores = [];

    fs.readdir(args.inputFolder, function(err,files) {
      if (err) {
        console.error('there are no files in the input folder:',args.inputFolder);

        console.error('We need the predicted output from the classifiers in that folder in order to ensemble the results together. Please run this library again, or copy/paste the results into the input folder, to create an ensemble.');
      } else {
        console.log('We found ' + files.length + ' files in the directory where you\'re storing the predictions');
        findFilesCallback(args, files);
      }
    });
  },

  readFiles: function(args, files) {
    global.ensembleNamespace.fileCount = files.length;
    global.ensembleNamespace.finishedFiles = 0;
    global.ensembleNamespace.dataMatrix = [];

    console.log('We are reading in all the relevant predictions files. This might take a little while if you\'ve made many predictions.')

    module.exports.readOneFile(args, files[0], files, module.exports.processOneFilesDataMatrix);


    if(global.ensembleNamespace.fileCount === 0) {
      // inside of readOneFile, the first thing we do is check (synchronously), whether that file is eligible or not
        // eligibility meaning is it a .csv file, and does it have our fileNameIdentifier in the file's name?
      // if we find it is not eligible, we are not going to engage in the asynchronous process of reading the file in, and will just finish as a purely synchronous process. 
      // in other words, if we have reached this point and fileCount is 0, we have synchornously checked all files and determined none are eligible.
      console.error('we found no eligible files in',args.inputFolder);
      console.error('please make sure that: \n 1. there are .csv files in that location, and \n 2. those .csv files include in their file names the string you passed in for the first argument to ensembler, which was:', fileNameIdentifier);
    }
  },

  readOneFile: function(args, fileName, files, readOneFileCallback) {
    // recursion! i'm just bundling the base case and the next iteration into a single function, as there are several places we might invoke these
    var readNextFile = function() {
      if( files.length ) {
        module.exports.readOneFile(args, files.shift(), files, readOneFileCallback);
      } else {
        if(global.ensembleNamespace.finishedFiles >= global.ensembleNamespace.fileCount) {

          if( args.validationRound ) {
            module.exports.removeIdsFromValidation(args);
          } else {
            module.exports.averageResults(args);        
          }

        }

      }
    };

    var fileNameIdentifier = args.fileNameIdentifier;
    // only read .csv files, and make sure we only read in files that include the fileNameIdentifier the user passed in. 
    if (fileName.slice(-4).toLowerCase() === '.csv' && fileName.indexOf(fileNameIdentifier) !== -1) {
      // grab all the characters in the file name that are not '.csv' or the fileNameIdentifier that will be shared across all these files. 
      // what we are left with is a unique string for just this file that is a unique identifier for this particular algorithm. 
      var prettyFileName = fileName.slice(0,-4);
      prettyFileName = prettyFileName.split(fileNameIdentifier).join('');
      global.ensembleNamespace.summarizedAlgorithmNames.push(prettyFileName);

      var filePath = path.join(args.inputFolder,fileName);

      // read in this predictions file
      fs.readFile(filePath, function(err, data) {
        data = data.toString();
        if(err) {
          console.log('we had trouble reading in a file.');
          console.error(err);
        }

        var output = Baby.parse(data).data;
        // the Baby parser adds on an extra blank line at the end of the file, so we want to remove that. 
        output.pop();
        // try to have the garbage collector kick in a little bit more quickly by explicitly removing the reference to data from fs.readFile
        data = null;

        if(err) {
          console.log('we had trouble interpreting this file\'s data as csv data');
          console.log(filePath);
          console.error(err);
        } else {
          readOneFileCallback(output, args, fileName);
          // similarly, explicitly remove reference to the output variable to help garbage collection start more quickly.
          output = null;
        }

        readNextFile();
      });
    } else {
      // if the file is not a .csv file, we will ignore it, and remove it from our count of files to parse
      console.log('found a file that is not a prediction file:', fileName);
      console.log('this is only a concern if you expected',fileName, 'to be a file filled with useful predictions on your current data set.')
      global.ensembleNamespace.fileCount--;
      // console.log('finishedFiles:', global.ensembleNamespace.finishedFiles);
      // console.log('fileCount:',global.ensembleNamespace.fileCount);
      if(global.ensembleNamespace.finishedFiles >= global.ensembleNamespace.fileCount) {

        if( args.validationRound ) {
          module.exports.removeIdsFromValidation(args);
        } else {
          module.exports.averageResults(args);        
        }

      } else {

        readNextFile();
      }
    }
  },

  checkIfMatrixIsEmpty: function(matrixLength) {
    // populate the matrix with empty arrays for each row if the matrix is empty
    var returnVal = false;
    if( global.ensembleNamespace.dataMatrix[0] === undefined) {
      returnVal = true;
      // our matrix has two non-predictions rows (scores row, and headerRow) that we want to ignore
      for (var i = 0; i < matrixLength - 2; i++) {
        global.ensembleNamespace.dataMatrix.push([]);
      }
    }
    return returnVal
  },

  processOneFilesDataMatrix: function(data, args, fileName) {
    // i know it's weird to see, but checkIfMatrixIsEmpty is synchronous. 
    var matrixIsEmpty = module.exports.checkIfMatrixIsEmpty(data.length);
    
    if( matrixIsEmpty ) {
      // the second row holds the headerRow
      global.ensembleNamespace.headerRow = data[1];

      // push the row IDs in as the first item in each row
      // again, ignore the first two rows
      for(var i = 2; i < data.length; i++) {
        var id = data[i][0];
        global.ensembleNamespace.dataMatrix[i - 2].push(id);
      }
    }

    // make sure we have the right number of predictions here
    if( data.length - 2 === global.ensembleNamespace.dataMatrix.length ) {
      // the first row holds the validationScore and trainingScore for this algorithm
      var scoresObj = {
        scores: data[0],
        fileName: fileName
      };

      global.ensembleNamespace.scores.push(scoresObj);


      // TODO: verify matrix's shape to make sure we have the same number of predictions across all classifiers.
      for( var i = 2; i < data.length; i++ ){
        var hasErrors = false;
        // data[i] is an array holding two values: the id for that row, and the actual predicted result.
        var id = data[i][0];
        var prediction = data[i][1];

        // TODO: verification. make sure this ID is the same as the id stored as the first item in the dataMatrix[i] array.
        // our predictions files have two non-predictions lines (scores, and headerRow)
        // our actual validation data file (saved as a scipy.sparse matrix in python), does not
        // therefore, we need to bump up each item by two, to match up to the format of the data we already have in python
        try {
          global.ensembleNamespace.dataMatrix[i - 2].push(prediction);

        } catch(err) {
          hasErrors = true;
          console.log(i);
          console.error(err);
        }
      }
      
    } else {
      console.error('this file had a different number of predictions than we expected:');
      console.error(fileName);
      console.error('expected number of predictions:',global.ensembleNamespace.dataMatrix.length);
      console.error('actual number of predictions:',data.length);
    }


    // remove reference to data to help garbage collection start more rapidly.
    data = null;

    global.ensembleNamespace.finishedFiles++;    
  },

  getAllClasses: function() {
    var allClasses = {};
    for( var i = 0; i < global.ensembleNamespace.dataMatrix.length; i++) {
      var row = global.ensembleNamespace.dataMatrix[i];
      for( var j = 0; j < row.length; j++ ) {
        allClasses[row[j]] = row[j];
      }
    }
    return allClasses;
    
  },

  classesToIndexMap: function(allClasses) {
    var classes = Object.keys(allClasses);
    for( var key in allClasses ) {
      allClasses[key] = classes.indexOf(key);
    }
    return allClasses;
  },

  invert: function(obj) {
    var inverted = {};
    for(var key in obj) {
      inverted[obj[key]] = key;
    }
    return inverted;
  },

  getXthPopularClass: function(predictionCounts, indexToClassesMap, sortedVoteCounts, x) {

    // once we know that the most voted class received, say 18 votes, find which index position received 18 votes
    var voteCountToFind = sortedVoteCounts[x];
    var voteIndex = predictionCounts.indexOf(sortedVoteCounts[x]);

    // then translate that index position to the class name
    var targetClass = indexToClassesMap[voteIndex];

    return targetClass;

  },

  multiclassFeatureEngineering: function( predictionsToAggregate, classesToIndexMap, indexToClassesMap) {
    var resultRow = [];
    // create a blank array with a placeholder 0 as the starting count for each class
    var predictionCounts = Array(Object.keys(classesToIndexMap).length);
    for(var z = 0; z < predictionCounts.length; z++) {
      predictionCounts[z] = 0;
    }


    // gather the total count of each different prediction
    for(var j = 0; j < predictionsToAggregate.length; j++ ) {
      var prediction = predictionsToAggregate[j];
      predictionCounts[classesToIndexMap[prediction]]++;

    }

    resultRow = resultRow.concat(predictionCounts);


    // get the vote counts, sorted from most to least
    var sortedVoteCounts = predictionCounts.slice().sort(function(a,b) {return b - a;});

    // get the three most highly voted classes for this row
    for( var k = 0; k < 3; k++) {
      var kthMostPopularClass = module.exports.getXthPopularClass(predictionCounts, indexToClassesMap, sortedVoteCounts, k);
      resultRow.push( kthMostPopularClass );
    }

    return resultRow;

  },

  // TODO: investigate if we have the ID in the row at this point or not
  validationFeatureEngineering: function(args) {
    module.exports.filterEnsembledPredictions(false);

    var allClasses = module.exports.getAllClasses();
    var classesToIndexMap = module.exports.classesToIndexMap(allClasses);
    var indexToClassesMap = module.exports.invert(classesToIndexMap);

    // iterate through all the predictions, creating some new features for each row

    for( var i = 0; i < global.ensembleNamespace.dataMatrix.length; i++) {
      var row = global.ensembleNamespace.dataMatrix[i];
      // for now, we are not getting the probabilities for multiclass problems, just the prediction
      if( global.argv.fileNames.problemType === 'multi-category' ) {
        var allResults = module.exports.multiclassFeatureEngineering( row, classesToIndexMap, indexToClassesMap);
        
        var bestPredictions = global.ensembleNamespace.acceptablePredictions[i];
        var bestResults = module.exports.multiclassFeatureEngineering( bestPredictions, classesToIndexMap, indexToClassesMap);

        // var aggregatedRow = row.concat(allResults, bestResults);
        var aggregatedRow = allResults.concat(bestResults);

        global.ensembleNamespace.dataMatrix[i] = aggregatedRow;


      } else {
        row.push( math.mean(row) );
        row.push( math.median(row) );
        row.push( math.max(row) );
        row.push( math.min(row) );

        row.push( math.max(row) - math.min(row) ); // this is the total range of predictions

        row.push( math.sum(row) );
        row.push( math.var(row) ); //this is the variance

        // calculate the consensus vote, as well as what percent of classifiers had that vote. 
        // console.log('global.argv');
        // console.log(global.argv)
        if( global.argv.fileNames.problemType === 'category') {
          // TODO: generalize this to work with multi-category predictions
          var roundedRow = [];
          var voteCount = {
            0 : 0,
            1 : 0
          };
          for(var j = 0; j < row.length; j++) {
            if( row[j] < 0.5 ) {
              roundedRow.push(0);
              voteCount['0']++
            } else {
              roundedRow.push(1);
              voteCount['1']++
            }
          }

          // push in the raw counts for each category
          row.push(voteCount['0']);
          row.push(voteCount['1']);

          // if we have multiple modes in a row, math.mode will return all of them to us
          // for now, we're taking the simplest approach and just grabbing the first item from the mode
          var rowMode = math.mode(roundedRow)[0];
          row.push( rowMode );
          // what percent of this row does that mode represent?
          row.push( voteCount[ rowMode ] / roundedRow.length );

        }
      }
    }

    module.exports.writeToFile( args, global.ensembleNamespace.dataMatrix );

  },

  removeIdsFromValidation: function(args) {

    // the first item in each row is the id. we want to remove that. 
    for(var i = 0; i < global.ensembleNamespace.dataMatrix.length; i++) {
      global.ensembleNamespace.dataMatrix[i].shift();
    }
    module.exports.validationFeatureEngineering(args);
    
  },

  // gather only those results that are within 2% of our most accurate model
  filterEnsembledPredictions: function(prependTrueForID) {
    // find our max accuracy score
    var maxScore = 0;
    for( var i = 0; i < global.ensembleNamespace.scores.length; i++ ) {
      var row = global.ensembleNamespace.scores[i];
      var score = parseFloat(row.scores[0],10);
      if( score > maxScore ) {
        maxScore = score;
      }
    }


    // iterate through the whole scores array. 
      // map each score to true or false marking whether it is within 2% of our most accurate model
      var acceptableModels = [];
      for( var j = 0; j < global.ensembleNamespace.scores.length; j++ ) {
        var row = global.ensembleNamespace.scores[j];
        var score = parseFloat(row.scores[0],10);
        if( score >= maxScore * .98 ) {
          acceptableModels.push(true);
        } else {
          acceptableModels.push(false);
        }
      }


    // we invoke this function multiple times at different stages in the process where we may or may not still have the ID column attached
    if(prependTrueForID) {
      // the first item in each row is the ID of that row, and we want to keep it
      // however, the scores row does not have an ID in it, which would lead to an off-by-one error
      // adding true to the start of the acceptableModels row both ensures that we will keep the id in each row of predictions, and that now our acceptableModels will line up with the predictions in each row, rather than being shfited over by 1
      acceptableModels.unshift(true);
    }


    // iterate through our predictions
      // save only those predictions that come from our best models

      var acceptablePredictions = [];
      for( var k = 0; k < global.ensembleNamespace.dataMatrix.length; k++ ) {
        var row = global.ensembleNamespace.dataMatrix[k];
        acceptablePredictions.push([]);
      // console.log(row[0]);

      for( var l = 0; l < row.length; l++ ) {
        if( acceptableModels[l]) {
          acceptablePredictions[k].push( row[l] );
        }
      }
    }


    global.ensembleNamespace.acceptablePredictions = acceptablePredictions;
  },

  averageResults: function(args) {
    // console.log('global.ensembleNamespace.dataMatrix');
    // console.log(global.ensembleNamespace.dataMatrix);

    module.exports.filterEnsembledPredictions(true);
    
    var idAndPredictionsByRow = [];
    for( var i = 0; i < global.ensembleNamespace.acceptablePredictions.length; i++ ) {

      var row = global.ensembleNamespace.acceptablePredictions[i];

      // the first value in each row is the ID for that row, so we will run this aggregation over all values in the row except the first one
      if( global.argv.fileNames.problemType === 'multi-category' ) {
        // if we have multiple modes in a row, math.mode will return all of them to us
        // for now, we're taking the simplest approach and just grabbing the first item from the mode
        var rowResult = math.mode(row.slice(1))[0];

      } else {
        var rowResult = math.mean(row.slice(1));
      }

      idAndPredictionsByRow.push([row[0], rowResult]);
    }

    global.ensembleNamespace.idAndPredictionsByRow = idAndPredictionsByRow;

    module.exports.copyBestScores(args);

  },


  copyBestScores: function(args) {

    // sort the array holding all of our validation and training scores:
    global.ensembleNamespace.scores.sort(function(algo1,algo2) {
      try {
        // scores is an array with validation and training scores from machineJS. 
        // the validation score is at index 0. 
        return parseFloat(algo1.scores[0]) - parseFloat(algo2.scores[0]);
      } catch(err) {
        return algo1.scores[0] - algo2.scores[0];
      }
    });
    global.ensembleNamespace.scores.reverse();

    console.log('sorted scores!');
    console.log(global.ensembleNamespace.scores);

    var bestFolder = path.join(args.inputFolder, 'bestScores' + global.ensembleNamespace.fileNameIdentifier);
    fse.mkdirpSync( bestFolder );

    // copy our 5 best scores into their own folder. this lets us see quickly which algos worked, and then have our best results easily available for analysis.
    var bestScoresNum = Math.min(5, global.ensembleNamespace.scores.length);
    for( var i = 0; i < bestScoresNum; i++) {
      var predictionFile = global.ensembleNamespace.scores[i].fileName;
      var sourceFile = path.join( args.inputFolder, predictionFile );
      var destinationFile = path.join( bestFolder, predictionFile );
      fse.copySync(sourceFile, destinationFile);
    }
    module.exports.writeToFile( args, global.ensembleNamespace.idAndPredictionsByRow )
  },

  generateSummary: function(args, callback) {

    args.generateSummaryCallback = callback;

    module.exports.findFiles(args, module.exports.readFiles);

  },

  writeToFile: function(args, results) {
    // TODO: refactor to use the csv module.

    if( args.validationRound) {
      var writeFileName = path.join( args.inputFolder, 'idAndPredictions.csv');
    } else {
      var writeFileName = path.join(args.outputFolder, args.fileNameIdentifier + 'MachineJSResults.csv');

      // if we have encoded labels (if we were given values to predict of strings like ['NYC','SF','OAK'] instead of the numbers scikit-learn demands, like [0,1,2] ), turn them back into the strings we'd expect to see in the output
      if( global.argv.fileNames.labelEncoded) {
        // TODO: reverse the label encoding
        // console.log(results);
        var reverseLabelEncoder = module.exports.invert(global.argv.fileNames.labelMapping);
        for(var i = 0; i < results.length; i++) {
          var encodedPrediction = results[i][1];

          var labelPrediction = reverseLabelEncoder[encodedPrediction];
          results[i][1] = labelPrediction;
        }
      }

      var finalHeaderRow = [global.argv.fileNames['idHeader'], global.argv.fileNames['outputHeader']]
      results.unshift(finalHeaderRow);
    }

    fastCSV.writeToPath(writeFileName, results)
    .on('finish',function() {


      if(args.validationRound) {
        console.log('We have just written the accumulated predictions from the stage 0 classifiers to a file that is saved at:\n' + writeFileName );

        // we have to load in machineJS here to ensure that processArgs has been run
        try {
          // ideally, we want ensembler to be run with machineJS
          // attempt to load in the parent machineJS, which has ensembler installed as an npm dependency
          var machineJSPath = path.join(global.argv.machineJSLocation, 'machineJS.js');
          var machineJS = require(machineJSPath);
        } catch(err) {
          console.log('heard an error trying to load up machineJS from the parent directory, rather than from a node_module');
          console.log('loading it in from the node_module instead');
          console.error(err);
          // otherwise, load in machineJS from it's npm dependencies
          // NOTE: right now, this will only work when invoked from machineJS
          // and it will probably be a bit of a pain to make it work without being invoked from machineJS
          var machineJS = require('machinejs');
        }

        // TODO: give the outputFile a prettier name, one that matches with the prettyName from machineJS
        // TODO: make sure this is the right folder we want to be writing validationAndPredictions to
        var aggregatedValidationFile = path.join(args.inputFolder, 'validationAndPredictions.npz')
        var fileNamesObj = {
          predictionsFile: writeFileName,
          validationData: path.join(args.inputFolder, 'validationData.npz'),
          outputFile: aggregatedValidationFile
        };


        // appendPredictionsToValidationData.py will start a python shell and append the data we have just written to the end (hstack) of the validation data
        // once that's done, it will invoke the callback, which restarts machineJS
        var pyChild = pythonUtils(fileNamesObj, 'appendPredictionsToValidationData.py', function() {
          process.emit('finishedFormatting');

          // make sure to pass in the right prettyNames and all that.
          global.argv.validationRound = true;
          global.argv.dataFile = aggregatedValidationFile;
          global.argv.validationYs = path.join(args.inputFolder, 'validationYs.npz');
          global.argv.validationIDs = path.join(args.inputFolder, 'validationIDs.npz');
          global.argv.devEnsemble = false;
          global.argv.alreadyFormatted = true;
          global.argv.dev = false;
          global.argv.ensemble = false;

          // have significantly fewer rounds, but make each round more meaningful, with more iterations per round
          global.argv.numRounds = 1;
          global.argv.numIterationsPerRound = 20;
          // now pass the validation set back to machineJS to have it choose how to ensemble all these early predictions together!
          machineJS(global.argv);
        });

        // we will be running through ensembler twice:
          // once to 
            // assemble all the predictions from each individual algo together, 
            // add them onto each row of the validation set, 
            // and then restart machineJS on that validation + predictions data set
          // secondly to
            // blend together all the predictions we make from that second round of machineJS. 

      } else {

        var finalLogAndShutdown = function() {
          console.log('We have just written the final predictions to a file that is saved at:\n' + writeFileName );
          console.log('Thanks for letting us help you on your machine learning journey! Hopefully this freed up more of your time to do the fun parts of ML. Pull Requests to make this even better are always welcome!');

          // this is designed to work with machineJS to ensure we have a proper shutdown of any stray childProcesses that might be going rogue on us. 
          process.emit('killAll');
        }


        if(global.argv.matrixOutput) {
          console.log('inside matrixOutput')

          var pythonArgs = {
            resultsFile: writeFileName, //a single column with our final predictions on the test data
            matrixOutputFolder: args.outputFolder,
            outputFileName: args.fileNameIdentifier + 'MatrixFinalOutputMachineJSResults.csv',
          };
          pythonUtils(pythonArgs, 'matrixOutput.py', function() {
            console.log('we have written the data in a matrix output format in the following file:');
            finalLogAndShutdown();
          });
        } else {
          finalLogAndShutdown();
        }

      }
    });
  }
};
