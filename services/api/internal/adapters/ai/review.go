package ai

// WeightedKappa is Cohen's kappa with quadratic weights for two raters scoring the same items on
// categories 0..k-1 (the human review rubric, AI_EVALS §8). ok is false below two items.
func WeightedKappa(a, b []int, k int) (kappa float64, ok bool) {
	n := len(a)
	if n < 2 || n != len(b) || k < 2 {
		return 0, false
	}
	obs := make([][]float64, k)
	for i := range obs {
		obs[i] = make([]float64, k)
	}
	ra, rb := make([]float64, k), make([]float64, k)
	for i := range a {
		x, y := min(max(a[i], 0), k-1), min(max(b[i], 0), k-1)
		obs[x][y]++
		ra[x]++
		rb[y]++
	}
	var num, den float64
	for i := range k {
		for j := range k {
			w := float64((i-j)*(i-j)) / float64((k-1)*(k-1))
			num += w * obs[i][j]
			den += w * ra[i] * rb[j] / float64(n)
		}
	}
	if den == 0 {
		return 1, true // both raters used one identical category throughout
	}
	return 1 - num/den, true
}
