export default interface MultiProblemProcessedResults {
    avgInitialTrainingEpochs: number,
    stdInitialTrainingEpochs: number,
    avgTotalSuccessfulEpochs: number,
    stdTotalSuccessfulEpochs: number,
    avgInitialEpochsForEachProblem: number[],
    stdInitialEpochsForEachProblem: number[],
    simCount: number,
    avgRetryCount: number,
    stdRetryCount: number,
    failedToLearnInitiallyCount: number,
    percFailedToLearnInitially: number,
    problemNames: string[],
    maxRetrainsAllowed: number,
    failedToRetainInitiallyCount: number,
    failedToRetrainCount: number,
    percFailedToRetrain: number,
    avgRetrainingEpochs: number,
    stdRetraningEpochs: number
}